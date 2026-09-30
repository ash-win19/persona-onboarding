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

describe('onboarding progress and automatic finish', () => {
  let app: INestApplication, pg: PGlite, db: Database;
  let command: Record<string, unknown> = {};
  let emit: (event: VoiceEvent) => Promise<void>;
  let voiceCommand: (input: RepairInput) => unknown;
  const sent: Record<string, unknown>[] = [];
  const steps: (string | null | undefined)[] = [];
  const origin = 'https://persona.example';
  const blank = () => ({
    tasks: [],
    replaceTasks: false,
    noTasksEvidence: null,
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
      steps.push(result.permittedGoal);
      return result.state.graduated
        ? "You're all set, Ashwin!"
        : `Next: ${result.permittedGoal}`;
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
    steps.length = 0;
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
  const verifyGmail = (id: string) =>
    db.query('UPDATE conversations SET gmail_verified_at=now() WHERE id=$1', [
      id,
    ]);
  // Everything except the first task, so the next detail finishes onboarding.
  async function almostReady() {
    const s = await session();
    await verifyGmail(s.id);
    command = { changes: names };
    const response = await s.send('Call yourself Atom. I am Ashwin.');
    expect(response.body.onboarding.intake.ready).toBe(false);
    expect(steps.at(-1)).toBe('helpRequest');
    return s;
  }

  it('saves all tasks and finishes as soon as Google connects', async () => {
    const s = await session();
    command = { changes: names, intake: { ...blank(), tasks } };
    const first = await s.send(
      'Call yourself Atom. I am Ashwin. I want to buy groceries and go to the gym.',
    );
    expect(first.body.onboarding.intake.tasks).toEqual([
      'buy groceries',
      'go to the gym',
    ]);
    expect(first.body.onboarding.graduated).toBe(false);
    expect(steps.at(-1)).toBe('gmail');
    await s.post('/journey', { action: 'skip' }).expect(409);
    const early = await s
      .post('/onboarding/plan', { action: 'finish' })
      .expect(200);
    expect(early.body.journey.entered).toBe(false);
    await verifyGmail(s.id);
    const finished = await s
      .post('/onboarding/plan', { action: 'finish' })
      .expect(200);
    expect(finished.body.journey.entered).toBe(true);
    expect(finished.body.onboarding).toMatchObject({
      graduated: true,
      onboardingComplete: true,
    });
    expect(finished.body.onboarding.intake.plan).toMatchObject({
      accepted: true,
      steps: ['Start with: buy groceries', 'Then work on: go to the gym'],
    });
    expect(finished.body.turns.at(-1)).toMatchObject({
      kind: 'handoff',
      content: "You're all set, Ashwin! Let's head in and get started.",
    });
    // A client from before automatic finishing still gets the same result.
    const again = await s
      .post('/onboarding/plan', { action: 'accept', id: 'old-plan' })
      .expect(200);
    expect(again.body.turns).toHaveLength(finished.body.turns.length);
    await migrate(db);
    expect((await s.read()).body.journey.entered).toBe(true);
  });

  it('finishes in the same reply that supplies the last detail', async () => {
    const s = await almostReady();
    command = { intake: { ...blank(), tasks } };
    const reply = await s.send('I want to buy groceries and go to the gym.');
    expect(reply.body.journey.entered).toBe(true);
    expect(reply.body.onboarding).toMatchObject({
      graduated: true,
      onboardingComplete: true,
    });
    expect(reply.body.turns.at(-1).content).toBe("You're all set, Ashwin!");
  });

  it('accepts a no-task choice without inventing work', async () => {
    const s = await almostReady();
    command = { intake: { ...blank(), noTasksEvidence: 'nothing yet' } };
    const reply = await s.send('I have nothing yet.');
    const intake = reply.body.onboarding.intake;
    expect(intake).toMatchObject({ tasks: [], noTasks: true });
    expect(intake.plan.steps[0]).toContain('whenever');
    expect(reply.body.journey.entered).toBe(true);
  });

  it('works through the missing details in order and moves past a postponed step', async () => {
    const s = await session();
    command = { intake: { ...blank(), tasks } };
    await s.send('I want to buy groceries and go to the gym.');
    command = { changes: [names[0]] };
    await s.send('Call yourself Atom.');
    command = { changes: [names[1]] };
    await s.send('I am Ashwin.');
    command = {};
    await s.send('What can you do?');
    command = {
      preferences: [
        { goal: 'gmail', outcome: 'deferred', evidence: 'Gmail later' },
      ],
    };
    const deferred = await s.send('Gmail later.');
    expect(steps).toEqual(['agentName', 'userName', 'gmail', 'gmail', null]);
    expect(deferred.body.onboarding.graduated).toBe(false);
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
  async function startCall(s: Awaited<ReturnType<typeof session>>) {
    const tabId = randomUUID(),
      id = randomUUID();
    const control = await s
      .post('/control', { tabId, takeover: false })
      .expect(200);
    const post = (path: string, body: object) =>
      s
        .post(path, body)
        .set('X-Persona-Tab', tabId)
        .set('X-Persona-Epoch', String(control.body.control.epoch));
    await post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    return {
      id,
      post,
      end: () => post('/calls/end', { id, reason: 'user_hangup' }).expect(200),
    };
  }
  const spokenName = (input: RepairInput, name: string) => ({
    expectedRevision: input.state.revision,
    askOnboarding: true,
    changes: [
      {
        goal: 'userName',
        action: 'set',
        value: name,
        evidence: `Call me ${name}`,
      },
    ],
    preferences: [],
    exitEvidence: null,
    intake: blank(),
  });
  async function speech(item: string, transcript: string) {
    await emit({ type: 'input_audio_buffer.committed', item_id: item });
    await emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: item,
      transcript,
    });
  }
  const spokenTask = (input: RepairInput) => ({
    expectedRevision: input.state.revision,
    askOnboarding: true,
    changes: [],
    preferences: [],
    exitEvidence: null,
    intake: {
      ...blank(),
      tasks: [{ value: 'buy groceries', evidence: 'buy groceries' }],
    },
  });
  it('finishes by speech and keeps the same call active on dashboard entry', async () => {
    const s = await almostReady();
    voiceCommand = spokenTask;
    const call = await startCall(s);
    await speech('last-detail', 'Help me buy groceries.');
    await vi.waitFor(async () =>
      expect((await s.read()).body.journey.entered).toBe(true),
    );
    await vi.waitFor(() =>
      expect(
        JSON.stringify(sent.filter((e) => e.type === 'response.create')),
      ).toContain('onboarding just finished'),
    );
    const status = await request(app.getHttpServer())
      .get('/calls/status')
      .set('Cookie', s.cookie)
      .expect(200);
    expect(status.body.call).toMatchObject({ id: call.id, status: 'active' });
    await call.end();
  });
  it('finishes from typed input during a muted text-only call', async () => {
    const s = await almostReady();
    voiceCommand = spokenTask;
    const call = await startCall(s);
    await call
      .post('/calls/preferences', {
        id: call.id,
        revision: 1,
        microphoneEnabled: false,
        replyMode: 'text',
      })
      .expect(200);
    await call
      .post('/calls/turns', {
        id: call.id,
        submissionId: randomUUID(),
        content: 'Help me buy groceries.',
      })
      .expect(200);
    await vi.waitFor(async () =>
      expect((await s.read()).body.journey.entered).toBe(true),
    );
    await vi.waitFor(() =>
      expect(
        sent.filter((e) => e.type === 'response.create').at(-1),
      ).toMatchObject({ response: { output_modalities: ['text'] } }),
    );
    const status = await request(app.getHttpServer())
      .get('/calls/status')
      .set('Cookie', s.cookie)
      .expect(200);
    expect(status.body.call).toMatchObject({
      id: call.id,
      status: 'active',
      microphoneEnabled: false,
      replyMode: 'text',
    });
    await call.end();
  });

  it('captures typed details after discarding partial microphone input', async () => {
    const s = await session();
    voiceCommand = (input) => spokenName(input, 'Rowan');
    const call = await startCall(s);
    await emit({
      type: 'input_audio_buffer.speech_started',
      item_id: 'discarded-partial',
    });
    await call
      .post('/calls/preferences', {
        id: call.id,
        revision: 1,
        microphoneEnabled: false,
        replyMode: 'text',
      })
      .expect(200);
    const replies = sent.filter(
      (event) => event.type === 'response.create',
    ).length;
    await emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'discarded-partial',
      transcript: 'Call me Wrong.',
    });
    expect(
      sent.filter((event) => event.type === 'response.create'),
    ).toHaveLength(replies);
    expect((await s.read()).body.onboarding.facts.userName.value).toBeNull();
    await call
      .post('/calls/turns', {
        id: call.id,
        submissionId: randomUUID(),
        content: 'Call me Rowan.',
      })
      .expect(200);
    await vi.waitFor(async () =>
      expect((await s.read()).body.onboarding.facts.userName.value).toBe(
        'Rowan',
      ),
    );
    await emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'discarded-partial',
      transcript: 'Call me Wrong.',
    });
    expect((await s.read()).body.onboarding.facts.userName.value).toBe('Rowan');
    await call.end();
  });

  it('recaptures the current input when reply format changes during interpretation', async () => {
    const s = await session();
    let finish!: (value: unknown) => void;
    let first: RepairInput | undefined;
    const blocked = new Promise((resolve) => {
      finish = resolve;
    });
    voiceCommand = (input) => {
      first = input;
      return blocked;
    };
    const call = await startCall(s);
    await speech('mode-change-source', 'Call me Taylor.');
    await vi.waitFor(() => expect(first).toBeDefined());
    voiceCommand = (input) => spokenName(input, 'Taylor');
    await call
      .post('/calls/preferences', {
        id: call.id,
        revision: 1,
        microphoneEnabled: false,
        replyMode: 'text',
      })
      .expect(200);
    await vi.waitFor(async () =>
      expect((await s.read()).body.onboarding.facts.userName.value).toBe(
        'Taylor',
      ),
    );
    const reply = sent.filter((e) => e.type === 'response.create').at(-1)!
      .response as {
      metadata: { generation: string; sourceItem: string };
      instructions: string;
    };
    expect(sent.at(-1)).toMatchObject({
      type: 'response.create',
      response: { output_modalities: ['text'] },
    });
    finish(spokenName(first!, 'Wrong'));
    await blocked;
    await emit({
      type: 'response.created',
      response: {
        id: 'saved-reply',
        status: 'in_progress',
        metadata: reply.metadata,
      },
    });
    await call
      .post('/calls/preferences', {
        id: call.id,
        revision: 2,
        microphoneEnabled: false,
        replyMode: 'audio',
      })
      .expect(200);
    await emit({
      type: 'response.done',
      response: { id: 'saved-reply', status: 'cancelled' },
    });
    expect(
      sent.filter((e) => e.type === 'response.create').at(-1),
    ).toMatchObject({
      response: {
        output_modalities: ['audio'],
        instructions: reply.instructions,
      },
    });
    expect((await s.read()).body.onboarding.facts.userName.value).toBe(
      'Taylor',
    );
    await call.end();
  });

  it('does not finish while newer speech is awaiting interpretation', async () => {
    const s = await session();
    command = { changes: names, intake: { ...blank(), tasks } };
    await s.send(
      'Call yourself Atom. I am Ashwin. I want to buy groceries and go to the gym.',
    );
    let finish!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => {
      finish = resolve;
    });
    voiceCommand = () => pending;
    const call = await startCall(s);
    await speech('changing-task', 'Actually, change my task.');
    await verifyGmail(s.id);
    const held = await call
      .post('/onboarding/plan', { action: 'finish' })
      .expect(200);
    expect(held.body.journey.entered).toBe(false);
    await call.end();
    finish(undefined);
  });
  it('collects split speech after delayed transcription without repeating a saved question', async () => {
    const s = await session();
    voiceCommand = (input) => ({
      ...spokenName(input, 'Taylor'),
      intake: {
        ...blank(),
        tasks: [{ value: 'buy groceries', evidence: 'buy groceries' }],
      },
    });
    const call = await startCall(s);
    for (const item of ['name-part', 'task-part'])
      await emit({ type: 'input_audio_buffer.committed', item_id: item });
    await emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'task-part',
      transcript: 'Help me buy groceries.',
    });
    expect((await s.read()).body.onboarding.facts.userName.value).toBeNull();
    await emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'name-part',
      transcript: 'Call me Taylor.',
    });
    await vi.waitFor(async () => {
      const state = (await s.read()).body.onboarding;
      expect(state.facts.userName.value).toBe('Taylor');
      expect(state.intake.tasks).toEqual(['buy groceries']);
    });
    await call.end();
  });
  it('saves a spelled-out spoken name and keeps the turn when another detail is unverifiable', async () => {
    const s = await session();
    // Reproduces a production call: the interpreter "corrected" the name
    // from its spelling and re-proposed a task quoted from older history.
    voiceCommand = (input) => ({
      expectedRevision: input.state.revision,
      askOnboarding: true,
      changes: [
        {
          goal: 'agentName',
          action: 'set',
          value: 'ATOM',
          evidence: 'No, I said Adam, A-T-O-M.',
        },
      ],
      preferences: [],
      exitEvidence: null,
      intake: {
        ...blank(),
        tasks: [
          {
            value: 'schedule a Google Calendar meeting',
            evidence: 'To schedule a Google Calendar meeting.',
          },
        ],
      },
    });
    const call = await startCall(s);
    await speech('spelled-name', 'No, I said Adam, A-T-O-M.');
    await vi.waitFor(async () =>
      expect((await s.read()).body.onboarding.facts.agentName.value).toBe(
        'Atom',
      ),
    );
    expect((await s.read()).body.onboarding.intake.tasks).toEqual([]);
    await vi.waitFor(() =>
      expect(JSON.stringify(sent)).toContain(
        "couldn't be matched to their exact words",
      ),
    );
    expect(JSON.stringify(sent)).not.toContain('Retry saved speech');
    await call.end();
  });
  it('keeps a spoken capture when a transcript is saved during interpretation', async () => {
    const s = await session();
    voiceCommand = async (input) => {
      // Saving the assistant's previous line bumps the revision mid-way.
      await db.query(
        'UPDATE conversations SET revision=revision+1 WHERE id=$1',
        [s.id],
      );
      return spokenName(input, 'Taylor');
    };
    const call = await startCall(s);
    await speech('drift-name', 'Call me Taylor.');
    await vi.waitFor(async () =>
      expect((await s.read()).body.onboarding.facts.userName.value).toBe(
        'Taylor',
      ),
    );
    expect(JSON.stringify(sent)).not.toContain('Retry saved speech');
    await call.end();
  });
  it('retries a failed current-call capture without asking the user to repeat it', async () => {
    const s = await session();
    voiceCommand = () => {
      throw new Error('provider unavailable');
    };
    const call = await startCall(s);
    await speech('retry-name', 'Call me Sam.');
    await vi.waitFor(() =>
      expect(JSON.stringify(sent)).toContain('Retry saved speech'),
    );
    expect((await s.read()).body.onboarding.facts.userName.value).toBeNull();
    voiceCommand = (input) => spokenName(input, 'Sam');
    await call.post('/calls/retry-onboarding', {}).expect(200);
    await vi.waitFor(async () =>
      expect((await s.read()).body.onboarding.facts.userName.value).toBe('Sam'),
    );
    await call.end();
  });
  it('ignores late interpretation after new speech and retains the newer name', async () => {
    const s = await session();
    let finish!: (value: unknown) => void;
    let stale: unknown;
    const pending = new Promise<unknown>((resolve) => {
      finish = resolve;
    });
    voiceCommand = (input) => {
      stale = spokenName(input, 'Sam');
      return pending;
    };
    const call = await startCall(s);
    await speech('old-name', 'Call me Sam.');
    await vi.waitFor(() => expect(stale).toBeDefined());
    voiceCommand = (input) => spokenName(input, 'Jordan');
    await speech('new-name', 'Call me Jordan.');
    await vi.waitFor(async () =>
      expect((await s.read()).body.onboarding.facts.userName.value).toBe(
        'Jordan',
      ),
    );
    finish(stale);
    await pending;
    await emit({ type: 'rate_limits.updated' });
    expect((await s.read()).body.onboarding.facts.userName.value).toBe(
      'Jordan',
    );
    await call.end();
  });
});
