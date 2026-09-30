import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { ChatModule } from '../src/chat/chat.module.js';
import { DATABASE, type Database } from '../src/chat/database.js';
import { MODEL, OpenAIReplyModel } from '../src/chat/model.js';
import { CHAT_CONFIG } from '../src/chat/config.js';
import { migrate } from '../src/chat/migration.js';
import {
  CalendarProvider,
  CalendarError,
  CALENDAR_SCOPE,
  type CalendarEvent,
} from '../src/chat/calendar-provider.js';
import { Meetings } from '../src/chat/meetings.js';
import { FACT_REPAIR } from '../src/chat/fact-repair.js';
import type { OnboardingState } from '../src/chat/onboarding.js';
import {
  VOICE_PROVIDER,
  type VoiceEvent,
  type VoiceProvider,
} from '../src/chat/voice-provider.js';
import { invitedAccount } from './invited-account.js';

const origin = 'https://persona.example';
const task =
  'Schedule a 30-minute Google Meet with guest@example.test on December 20, 2099 at 3 PM Pacific, titled Persona demo, and email the invitation.';
function capture(state: OnboardingState, text: string) {
  return {
    expectedRevision: state.revision,
    askOnboarding: true,
    changes: [],
    preferences: [],
    memory: [],
    exitEvidence: null,
    intake: {
      tasks: [{ value: text, evidence: text }],
      replaceTasks: false,
      noTasksEvidence: null,
    },
  };
}
function draft(authorizationQuote = task) {
  return {
    draftId: null,
    expectedRevision: null,
    title: 'Persona demo',
    description: null,
    attendees: ['guest@example.test'],
    localStart: '2099-12-20T15:00',
    timeZone: 'America/Los_Angeles',
    durationMinutes: 30,
    authorizationQuote,
  };
}
class Google extends CalendarProvider {
  nonce = '';
  events = new Map<string, CalendarEvent>();
  inserts = 0;
  invitations = 0;
  override available() {
    return true;
  }
  override authorize(state: string, _challenge: string, nonce: string) {
    this.nonce = nonce;
    return `${origin}/consent?state=${state}`;
  }
  override async exchange() {
    return {
      accessToken: 'fake-access',
      refreshToken: 'fake-refresh',
      expiresAt: Date.now() + 3600000,
      scope: CALENDAR_SCOPE,
      idToken: 'fake-identity',
    };
  }
  override async identity() {
    return {
      subject: 'organizer',
      email: 'organizer@example.test',
      nonce: this.nonce,
    };
  }
  override async verifyAccess() {
    return {};
  }
  override async getEvent(_token: string, id: string) {
    const event = this.events.get(id);
    if (!event) throw new CalendarError('EVENT_NOT_FOUND', 404);
    return event;
  }
  override async insertEvent(_token: string, body: unknown) {
    this.inserts++;
    const event = {
      ...(body as CalendarEvent),
      etag: 'v1',
      htmlLink: 'https://calendar.google.com/calendar/event?eid=test',
      conferenceData: {
        entryPoints: [
          {
            entryPointType: 'video',
            uri: 'https://meet.google.com/abc-defg-hij',
          },
        ],
      },
    };
    this.events.set(event.id, event);
    return event;
  }
  override async invite(_token: string, event: CalendarEvent, body: unknown) {
    this.invitations++;
    const updated = { ...event, ...(body as CalendarEvent), etag: 'v2' };
    this.events.set(event.id, updated);
    return updated;
  }
}

describe('Calendar during unfinished onboarding', () => {
  let app: INestApplication;
  let postgres: PGlite;
  let db: Database;
  let google: Google;
  let modelServer: ReturnType<typeof createServer>;
  let failCapture = false;
  let meetingModelCalls = 0;
  let emit: (event: VoiceEvent) => Promise<void>;
  let sent: Record<string, unknown>[] = [];
  const voice: VoiceProvider = {
    connect: async (_sdp, _instructions, onEvent) => {
      emit = onEvent;
      return {
        providerId: 'rtc_test',
        sdp: 'v=0\r\nanswer',
        healthy: () => true,
        send: (e) => {
          sent.push(e);
        },
        close: async () => {},
      };
    },
  };
  beforeAll(async () => {
    vi.stubEnv('CALENDAR_SCHEDULING_ENABLED', 'true');
    vi.stubEnv('GMAIL_TOKEN_KEY', Buffer.alloc(32, 7).toString('base64'));
    vi.stubEnv('OPENAI_API_KEY', 'fake-local-key');
    modelServer = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      let name: string;
      let args: unknown;
      if (body.tool_choice?.name === 'capture_onboarding') {
        const state = JSON.parse(
          body.instructions.split('\nCurrent server state: ')[1].split('\n')[0],
        );
        name = 'capture_onboarding';
        args = failCapture ? {} : capture(state, body.input.at(-1).content);
      } else {
        meetingModelCalls++;
        const output = body.input.findLast(
          (item: { type: string }) => item.type === 'function_call_output',
        );
        const result = output && JSON.parse(output.output);
        name =
          result?.code === 'prepared' ? 'execute_meeting' : 'prepare_meeting';
        args =
          result?.code === 'prepared'
            ? {
                draftId: result.meeting.id,
                expectedRevision: result.meeting.revision,
              }
            : draft();
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id: randomUUID(),
          object: 'response',
          status: 'completed',
          output: [
            {
              type: 'function_call',
              call_id: randomUUID(),
              name,
              arguments: JSON.stringify(args),
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) =>
      modelServer.listen(0, '127.0.0.1', resolve),
    );
    const address = modelServer.address();
    if (!address || typeof address === 'string')
      throw new Error('No model port');
    const baseURL = `http://127.0.0.1:${address.port}/v1`;
    vi.stubEnv('OPENAI_BASE_URL', baseURL);
    postgres = new PGlite();
    db = {
      query: (s, v) => postgres.query(s, v),
      transaction: (work) => postgres.transaction((tx) => work(tx)),
    };
    await migrate(db);
    google = new Google();
    const module = await Test.createTestingModule({ imports: [ChatModule] })
      .overrideProvider(DATABASE)
      .useValue(db)
      .overrideProvider(MODEL)
      .useValue(new OpenAIReplyModel('fake', 'gpt-4.1-mini', baseURL))
      .overrideProvider(CalendarProvider)
      .useValue(google)
      .overrideProvider(VOICE_PROVIDER)
      .useValue(voice)
      .overrideProvider(FACT_REPAIR)
      .useValue({
        interpret: async ({
          state,
          sources,
        }: {
          state: OnboardingState;
          sources: { text: string }[];
        }) => capture(state, sources.at(-1)!.text),
      })
      .overrideProvider(CHAT_CONFIG)
      .useValue({ origins: [origin], secureCookies: true })
      .compile();
    app = module.createNestApplication();
    await app.init();
    // Advance the durable runner explicitly so assertions do not race its timer.
    app.get(Meetings).onModuleDestroy();
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await postgres?.close();
    await new Promise<void>((resolve) => modelServer.close(() => resolve()));
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    failCapture = false;
    sent = [];
    meetingModelCalls = 0;
    google.inserts = 0;
    google.invitations = 0;
  });
  async function session() {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(await invitedAccount(app))
      .expect(200);
    const cookie = login.headers['set-cookie'][0];
    const tabId = randomUUID();
    const claim = await request(app.getHttpServer())
      .post('/control')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .set('Cookie', cookie)
      .send({ tabId, takeover: false })
      .expect(200);
    const owner = { tabId, epoch: claim.body.control.epoch };
    return {
      id: login.body.conversationId,
      cookie,
      owner,
      read: () =>
        request(app.getHttpServer()).get('/session').set('Cookie', cookie),
      post: (path: string, body: object) =>
        request(app.getHttpServer())
          .post(path)
          .set('Origin', origin)
          .set('X-Persona-Client', 'web')
          .set('Cookie', cookie)
          .set('X-Persona-Tab', tabId)
          .set('X-Persona-Epoch', String(owner.epoch))
          .send(body),
    };
  }
  async function connect(s: Awaited<ReturnType<typeof session>>) {
    const start = await s.post('/calendar/start', {}).expect(200);
    const state = new URL(start.body.url).searchParams.get('state')!;
    await request(app.getHttpServer())
      .get('/calendar/callback')
      .set('Cookie', s.cookie)
      .query({ state, code: 'fake-code' })
      .expect(303)
      .expect('Location', origin + '/onboarding?calendar=connected');
  }
  it('saves a first task, resumes after consent, and creates exactly one event and invitation request', async () => {
    const s = await session();
    const reply = await s
      .post('/turns', { submissionId: randomUUID(), content: task })
      .expect(200);
    expect(reply.body.operation.status).toBe('completed');
    expect(reply.body.turns.at(-1).content).toContain('details are saved');
    expect(reply.body.onboarding.intake.tasks).toEqual([task]);
    expect(reply.body.onboarding.graduated).toBe(false);
    expect(reply.body.onboarding.gmail).toBe('not_connected');
    const assessments = await db.query<{ permitted_goal: string | null }>(
      'SELECT permitted_goal FROM onboarding_assessments WHERE conversation_id=$1',
      [s.id],
    );
    expect(assessments.rows.every((row) => row.permitted_goal === null)).toBe(
      true,
    );
    const meetings = app.get(Meetings);
    const pending = (await meetings.state(s.id)).meetings[0];
    expect(pending.status).toBe('connection_required');
    expect(pending.input.localStart).toBe('2099-12-20T15:00');
    await s
      .post(`/meetings/${pending.id}/execute`, {
        expectedRevision: pending.revision,
      })
      .set('X-Persona-Epoch', '99')
      .expect(403);
    await connect(s);
    await s
      .post(`/meetings/${pending.id}/execute`, {
        expectedRevision: pending.revision,
      })
      .expect(200);
    await s
      .post(`/meetings/${pending.id}/execute`, {
        expectedRevision: pending.revision,
      })
      .expect(200);
    await meetings.tick();
    const completed = (await meetings.state(s.id)).meetings;
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      status: 'completed',
      meetUrl: 'https://meet.google.com/abc-defg-hij',
    });
    await s
      .post(`/meetings/${pending.id}/execute`, {
        expectedRevision: pending.revision,
      })
      .expect(200);
    await meetings.tick();
    expect(google.inserts).toBe(1);
    expect(google.invitations).toBe(1);
    expect((await s.read()).body.journey.entered).toBe(false);
  });
  it('waits for Calendar as well as Gmail before finishing', async () => {
    const s = await session();
    const opening = (await s.read()).body.turns[0].id;
    for (const [goal, value] of [
      ['agentName', 'Atom'],
      ['userName', 'Ashwin'],
    ])
      await db.query(
        `INSERT INTO onboarding_facts(id,conversation_id,goal,value,status,source_turn_id,revision,evidence)
        VALUES($1,$2,$3,$4,'known',$5,1,$4)`,
        [randomUUID(), s.id, goal, value, opening],
      );
    await db.query(
      'UPDATE conversations SET gmail_verified_at=now(),onboarding_intake=$2 WHERE id=$1',
      [
        s.id,
        JSON.stringify({
          tasks: ['buy groceries'],
          noTasks: false,
          questionsAsked: 0,
          clarification: null,
          plan: null,
        }),
      ],
    );
    const waiting = await s
      .post('/onboarding/plan', { action: 'finish' })
      .expect(200);
    expect(waiting.body.onboarding).toMatchObject({
      calendarAvailable: true,
      calendar: 'not_connected',
      graduated: false,
      missingGoals: ['calendar'],
    });
    expect(waiting.body.journey.entered).toBe(false);
    await connect(s);
    const finished = await s
      .post('/onboarding/plan', { action: 'finish' })
      .expect(200);
    expect(finished.body.onboarding.calendar).toBe('connected');
    expect(finished.body.journey.entered).toBe(true);
  });
  it('does not run meeting tools when onboarding capture fails', async () => {
    const s = await session();
    failCapture = true;
    const result = await s
      .post('/turns', { submissionId: randomUUID(), content: task })
      .expect(200);
    expect(result.body.operation.status).toBe('failed');
    expect(meetingModelCalls).toBe(0);
    expect((await app.get(Meetings).state(s.id)).meetings).toEqual([]);
  });
  it('still requires a user instruction and attendee evidence before saving a draft', async () => {
    const s = await session();
    // A capability question is saved as user data, never permission to execute.
    const sourceId = randomUUID();
    await db.query(
      'INSERT INTO turns(id,conversation_id,submission_id,role,content) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), s.id, sourceId, 'user', 'Can you schedule a meeting?'],
    );
    const context = { conversationId: s.id, sourceId, owner: s.owner };
    const meetings = app.get(Meetings);
    expect(
      await meetings.tool(context, 'prepare_meeting', draft()),
    ).toMatchObject({ code: 'SCHEDULING_INSTRUCTION_REQUIRED' });
    await db.query('UPDATE turns SET content=$1 WHERE submission_id=$2', [
      task,
      sourceId,
    ]);
    expect(
      await meetings.tool(context, 'prepare_meeting', {
        ...draft(),
        attendees: ['invented@example.test'],
      }),
    ).toMatchObject({ code: 'ATTENDEE_ADDRESS_REQUIRED' });
    expect((await meetings.state(s.id)).meetings).toEqual([]);
  });
  it('saves finalized first-task speech before enabling voice meeting tools and rejects late tools', async () => {
    const s = await session();
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    await s.post('/calls/ready', { id }).timeout(3000).expect(200);
    await emit({
      type: 'response.created',
      response: {
        id: 'opening-response',
        status: 'in_progress',
        metadata: { generation: '0', purpose: 'opening' },
      },
    });
    await emit({
      type: 'response.done',
      response: { id: 'opening-response', status: 'completed' },
    });
    await emit({
      type: 'input_audio_buffer.speech_started',
      item_id: 'meeting-source',
    });
    await emit({
      type: 'input_audio_buffer.committed',
      item_id: 'meeting-source',
    });
    await emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'meeting-source',
      transcript: task,
    });
    await vi.waitFor(() =>
      expect(
        sent.some(
          (e) =>
            e.type === 'response.create' &&
            (e.response as { metadata: { purpose: string } }).metadata
              .purpose === 'meeting_reply',
        ),
      ).toBe(true),
    );
    const response = sent.findLast((e) => e.type === 'response.create')!
      .response as {
      tools: { name: string }[];
      tool_choice: string;
      metadata: object;
    };
    expect(response.tool_choice).toBe('auto');
    expect(response.tools.map((tool) => tool.name)).toContain(
      'prepare_meeting',
    );
    const saved = (await s.read()).body;
    expect(saved.onboarding.intake.tasks).toEqual([task]);
    expect(saved.journey.entered).toBe(false);
    await emit({
      type: 'response.created',
      response: {
        id: 'meeting-response',
        status: 'in_progress',
        metadata: response.metadata,
      },
    });
    await emit({
      type: 'response.function_call_arguments.done',
      response_id: 'meeting-response',
      call_id: 'prepare',
      name: 'prepare_meeting',
      arguments: JSON.stringify(draft()),
    });
    await vi.waitFor(async () =>
      expect((await app.get(Meetings).state(s.id)).meetings).toHaveLength(1),
    );
    const pending = (await app.get(Meetings).state(s.id)).meetings[0];
    await emit({
      type: 'response.function_call_arguments.done',
      response_id: 'meeting-response',
      call_id: 'execute',
      name: 'execute_meeting',
      arguments: JSON.stringify({
        draftId: pending.id,
        expectedRevision: pending.revision,
      }),
    });
    await vi.waitFor(async () =>
      expect((await app.get(Meetings).state(s.id)).meetings[0].status).toBe(
        'connection_required',
      ),
    );
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    expect(
      await app.get(Meetings).tool(
        {
          conversationId: s.id,
          callId: id,
          generation: 1,
          sourceId: 'meeting-source',
        },
        'execute_meeting',
        { draftId: pending.id, expectedRevision: pending.revision },
      ),
    ).toMatchObject({ code: 'STALE_REQUEST' });
    expect(google.inserts).toBe(0);
  });
});
