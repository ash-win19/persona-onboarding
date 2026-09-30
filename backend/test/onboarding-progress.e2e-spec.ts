import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ChatModule } from '../src/chat/chat.module.js';
import { DATABASE, type Database } from '../src/chat/database.js';
import { MODEL, type ReplyModel } from '../src/chat/model.js';
import { CHAT_CONFIG } from '../src/chat/config.js';
import { GMAIL_PROVIDER } from '../src/chat/gmail-provider.js';
import { TOKEN_KEY } from '../src/chat/gmail.js';
import { CONVERSATION_MEMORY, DisabledMemory } from '../src/chat/memory.js';
import { FACT_REPAIR, type RepairInput } from '../src/chat/fact-repair.js';
import { VOICE_PROVIDER, type VoiceEvent } from '../src/chat/voice-provider.js';
import { migrate } from '../src/chat/migration.js';
import { invitedAccount } from './invited-account.js';

describe('onboarding progress and accepted plan', () => {
  let app: INestApplication, pg: PGlite, db: Database;
  let command: Record<string, unknown> = {};
  let emit: (event: VoiceEvent) => Promise<void>;
  let voiceCommand: (input: RepairInput) => unknown;
  const sent: Record<string, unknown>[] = [];
  const origin = 'https://persona.example';
  const blank = () => ({
    tasks: [],
    replaceTasks: false,
    noTasksEvidence: null,
    clarification: null,
    stopQuestionsEvidence: null,
    plan: null,
    acceptPlan: null,
  });
  const model: ReplyModel = {
    reply: async (_, tools) => {
      const result = await tools.capture({
        expectedRevision: tools.state.revision,
        askOnboarding: true,
        changes: [],
        preferences: [],
        exitEvidence: null,
        intake: blank(),
        ...command,
      });
      if (!result.ok) throw new Error('CAPTURE_FAILED');
      return result.reply!;
    },
  };
  beforeAll(async () => {
    pg = new PGlite();
    db = {
      query: (s, v) => pg.query(s, v),
      transaction: (w) => pg.transaction((tx) => w(tx)),
    };
    await migrate(db);
    const module = await Test.createTestingModule({ imports: [ChatModule] })
      .overrideProvider(DATABASE)
      .useValue(db)
      .overrideProvider(MODEL)
      .useValue(model)
      .overrideProvider(CONVERSATION_MEMORY)
      .useValue(new DisabledMemory())
      .overrideProvider(GMAIL_PROVIDER)
      .useValue({ available: () => true })
      .overrideProvider(TOKEN_KEY)
      .useValue(Buffer.alloc(32, 1).toString('base64'))
      .overrideProvider(CHAT_CONFIG)
      .useValue({ origins: [origin], secureCookies: true })
      .overrideProvider(FACT_REPAIR)
      .useValue({
        interpret: async (input: RepairInput) => voiceCommand(input),
      })
      .overrideProvider(VOICE_PROVIDER)
      .useValue({
        connect: async (_s: string, _i: string, event: typeof emit) => {
          emit = event;
          return {
            providerId: 'rtc_progress',
            sdp: 'v=0',
            healthy: () => true,
            send: (e: Record<string, unknown>) => sent.push(e),
            close: async () => undefined,
          };
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });
  beforeEach(() => {
    command = {};
    sent.length = 0;
  });
  async function session() {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(await invitedAccount(app))
      .expect(200);
    const cookie = login.headers['set-cookie'][0];
    const post = (path: string, body: object) =>
      request(app.getHttpServer())
        .post(path)
        .set('Origin', origin)
        .set('X-Persona-Client', 'web')
        .set('Cookie', cookie)
        .send(body);
    return {
      id: login.body.conversationId as string,
      cookie,
      post,
      send: (content: string) =>
        post('/turns', { content, submissionId: randomUUID() }).expect(200),
      read: () =>
        request(app.getHttpServer())
          .get('/session')
          .set('Cookie', cookie)
          .expect(200),
    };
  }
  const names = [
    {
      goal: 'agentName',
      action: 'set',
      value: 'Atom',
      evidence: 'Call yourself Atom',
    },
    {
      goal: 'userName',
      action: 'set',
      value: 'Ashwin',
      evidence: 'I am Ashwin',
    },
  ];
  const tasks = [
    { value: 'buy groceries', evidence: 'buy groceries' },
    { value: 'go to the gym', evidence: 'go to the gym' },
  ];
  async function ready() {
    const s = await session();
    await db.query(
      'UPDATE conversations SET gmail_verified_at=now() WHERE id=$1',
      [s.id],
    );
    command = {
      changes: names,
      intake: {
        ...blank(),
        tasks,
        plan: ['Make a grocery list.', 'Sketch a gym session.'],
      },
    };
    const response = await s.send(
      'Call yourself Atom. I am Ashwin. I want to buy groceries and go to the gym.',
    );
    expect(response.body.operation.status).toBe('completed');
    expect(response.body.onboarding.intake.ready).toBe(true);
    return { s, plan: response.body.onboarding.intake.plan };
  }

  it('saves all tasks and waits for verified Gmail and an accepted current plan', async () => {
    const s = await session();
    command = {
      changes: names,
      intake: {
        ...blank(),
        tasks,
        plan: ['Make a grocery list.', 'Sketch a gym session.'],
      },
    };
    const first = await s.send(
      'Call yourself Atom. I am Ashwin. I want to buy groceries and go to the gym.',
    );
    expect(first.body.onboarding.intake.tasks).toEqual([
      'buy groceries',
      'go to the gym',
    ]);
    expect(first.body.onboarding.graduated).toBe(false);
    await s
      .post('/onboarding/plan', {
        action: 'accept',
        id: first.body.onboarding.intake.plan.id,
      })
      .expect(409);
    await s.post('/journey', { action: 'skip' }).expect(409);
    await db.query(
      'UPDATE conversations SET gmail_verified_at=now() WHERE id=$1',
      [s.id],
    );
    const review = await s
      .post('/onboarding/plan', { action: 'review' })
      .expect(200);
    expect(review.body.turns.at(-1).content).toContain(
      'Does this plan work for you?',
    );
    const planId = review.body.onboarding.intake.plan.id;
    const accepted = await s
      .post('/onboarding/plan', { action: 'accept', id: planId })
      .expect(200);
    expect(accepted.body.journey.entered).toBe(true);
    expect(accepted.body.onboarding.onboardingComplete).toBe(true);
    await s
      .post('/onboarding/plan', { action: 'accept', id: planId })
      .expect(200);
    await migrate(db);
    expect((await s.read()).body.journey.entered).toBe(true);
  });

  it('accepts a no-task choice without inventing work', async () => {
    const s = await session();
    await db.query(
      'UPDATE conversations SET gmail_verified_at=now() WHERE id=$1',
      [s.id],
    );
    command = {
      changes: names,
      intake: { ...blank(), noTasksEvidence: 'nothing yet' },
    };
    const reply = await s.send(
      'Call yourself Atom. I am Ashwin. I have nothing yet.',
    );
    const intake = reply.body.onboarding.intake;
    expect(intake).toMatchObject({ tasks: [], noTasks: true, ready: true });
    expect(intake.plan.steps[0]).toContain('whenever');
    await s
      .post('/onboarding/plan', { action: 'accept', id: intake.plan.id })
      .expect(200);
  });

  it('caps task clarification across turns and keeps a saved task', async () => {
    const s = await session();
    command = {
      intake: {
        ...blank(),
        tasks: [{ value: 'organize my work', evidence: 'organize my work' }],
        clarification: 'What outcome would make work easier?',
      },
    };
    await s.send('Help organize my work.');
    command = {
      intake: { ...blank(), clarification: 'Which deadline is most urgent?' },
    };
    await s.send('There are many deadlines.');
    command = {
      intake: { ...blank(), clarification: 'What else should I know?' },
    };
    const reply = await s.send('I already told you.');
    expect(reply.body.onboarding.intake).toMatchObject({
      questionsAsked: 2,
      clarification: null,
      tasks: ['organize my work'],
    });
    expect(reply.body.turns.at(-1).content).not.toContain('What else');
  });

  it('rejects stale approval and quoted or qualified yes, then accepts the revised plan once', async () => {
    const { s, plan } = await ready();
    command = {
      intake: { ...blank(), acceptPlan: { id: plan.id, evidence: 'yes' } },
    };
    expect(
      (await s.send('You said yes, but I did not.')).body.journey.entered,
    ).toBe(false);
    command = {
      intake: {
        ...blank(),
        plan: ['Sketch a gym session first.', 'Then make a grocery list.'],
      },
    };
    const revised = await s.send('Change the plan: start with the gym.');
    const current = revised.body.onboarding.intake.plan;
    expect(current.id).not.toBe(plan.id);
    await s
      .post('/onboarding/plan', { action: 'accept', id: plan.id })
      .expect(409);
    command = {
      intake: { ...blank(), acceptPlan: { id: current.id, evidence: 'Yes' } },
    };
    const final = await s.send('Yes.');
    expect(final.body.journey.entered).toBe(true);
    expect(final.body.turns.at(-1).content).toContain('Your plan is saved');
  });

  it('captures a finalized spoken task without any realtime tool call', async () => {
    const s = await session(),
      tabId = randomUUID(),
      callId = randomUUID();
    const control = await s
      .post('/control', { tabId, takeover: false })
      .expect(200);
    const post = (path: string, body: object) =>
      s
        .post(path, body)
        .set('X-Persona-Tab', tabId)
        .set('X-Persona-Epoch', String(control.body.control.epoch));
    voiceCommand = (input) => ({
      expectedRevision: input.state.revision,
      askOnboarding: true,
      changes: [],
      preferences: [],
      exitEvidence: null,
      intake: {
        ...blank(),
        tasks: [{ value: 'buy groceries', evidence: 'buy groceries' }],
        plan: ['Make a grocery list.'],
      },
    });
    await post('/calls/start', { id: callId, sdp: 'v=0' }).expect(200);
    await emit({
      type: 'input_audio_buffer.speech_started',
      item_id: 'spoken-task',
    });
    await emit({
      type: 'input_audio_buffer.committed',
      item_id: 'spoken-task',
    });
    await emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'spoken-task',
      transcript: 'I want to buy groceries.',
    });
    await vi.waitFor(
      async () =>
        expect((await s.read()).body.onboarding.intake.tasks).toEqual([
          'buy groceries',
        ]),
      { timeout: 10000 },
    );
    expect(sent.some((e) => e.type === 'response.create')).toBe(true);
    await post('/calls/end', { id: callId, reason: 'user_hangup' }).expect(200);
  });
});
