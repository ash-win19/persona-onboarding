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
      changes: [
        ...names,
        {
          goal: 'helpRequest',
          action: 'set',
          value: 'nothing yet',
          evidence: 'nothing yet',
        },
      ],
      preferences: [
        { goal: 'helpRequest', outcome: 'declined', evidence: 'nothing yet' },
        { goal: 'gmail', outcome: 'declined', evidence: 'nothing yet' },
      ],
      intake: { ...blank(), noTasksEvidence: 'nothing yet' },
    };
    const reply = await s.send(
      'Call yourself Atom. I am Ashwin. I have nothing yet.',
    );
    expect(reply.body.onboarding.facts.helpRequest.value).toBeNull();
    const intake = reply.body.onboarding.intake;
    expect(intake).toMatchObject({ tasks: [], noTasks: true, ready: true });
    expect(intake.plan.steps[0]).toContain('whenever');
    await s
      .post('/onboarding/plan', { action: 'accept', id: intake.plan.id })
      .expect(200);
  });

  it('keeps a validated task quote when the model paraphrases its value', async () => {
    const s = await session();
    command = {
      assistance: 'Subject: Test email\n\nBody: Hello, this is a test.',
      intake: {
        ...blank(),
        tasks: [
          { value: 'Write a sample message', evidence: 'Draft a test email' },
        ],
        plan: ['Review the draft.'],
      },
    };
    const reply = await s.send('Draft a test email');
    expect(reply.body.operation.status).toBe('completed');
    expect(reply.body.onboarding.intake.tasks).toEqual(['Draft a test email']);
    expect(reply.body.turns.at(-1).content).toContain('Subject: Test email');
  });

  it('does not turn a pure setup deferral into an extra generated question', async () => {
    const s = await session();
    command = {
      assistance: 'What would you like to call me?',
      preferences: [
        {
          goal: 'gmail',
          outcome: 'deferred',
          evidence: 'Not Gmail now, please.',
        },
      ],
      intake: { ...blank(), plan: ['Choose names', 'Connect Gmail'] },
    };
    const reply = await s.send('Not Gmail now, please.');
    expect(reply.body.operation.status).toBe('completed');
    expect(reply.body.turns.at(-1).content).not.toContain('?');
    expect(reply.body.onboarding.intake.plan).toBeNull();
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
  it('accepts the current plan by speech and keeps the same call active on dashboard entry', async () => {
    const { s, plan } = await ready();
    voiceCommand = (input) => ({
      expectedRevision: input.state.revision,
      askOnboarding: false,
      changes: [],
      preferences: [],
      exitEvidence: null,
      intake: { ...blank(), acceptPlan: { id: plan.id, evidence: 'Yes' } },
    });
    const call = await startCall(s);
    await speech('plan-yes', 'Yes.');
    await vi.waitFor(async () =>
      expect((await s.read()).body.journey.entered).toBe(true),
    );
    const status = await request(app.getHttpServer())
      .get('/calls/status')
      .set('Cookie', s.cookie)
      .expect(200);
    expect(status.body.call).toMatchObject({ id: call.id, status: 'active' });
    await call.end();
  });
  it('accepts the current plan by typed input during a muted text-only call', async () => {
    const { s, plan } = await ready();
    voiceCommand = (input) => ({
      expectedRevision: input.state.revision,
      askOnboarding: false,
      changes: [],
      preferences: [],
      exitEvidence: null,
      intake: { ...blank(), acceptPlan: { id: plan.id, evidence: 'Yes' } },
    });
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
        content: 'Yes.',
      })
      .expect(200);
    await vi.waitFor(async () =>
      expect((await s.read()).body.journey.entered).toBe(true),
    );
    expect(
      sent.filter((e) => e.type === 'response.create').at(-1),
    ).toMatchObject({ response: { output_modalities: ['text'] } });
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

  it('blocks button approval while newer speech is awaiting interpretation', async () => {
    const { s, plan } = await ready();
    let finish!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => {
      finish = resolve;
    });
    voiceCommand = () => pending;
    const call = await startCall(s);
    await speech('changing-plan', 'Actually, change that plan.');
    await call
      .post('/onboarding/plan', { action: 'accept', id: plan.id })
      .expect(409);
    expect((await s.read()).body.journey.entered).toBe(false);
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
        plan: ['Make a grocery list.'],
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
  it('keeps an onboarding tool continuation on the saved reply instead of stalling or ad-libbing', async () => {
    const s = await session();
    voiceCommand = (input) => ({
      ...spokenName(input, 'Taylor'),
      assistance: 'Subject: Test email\n\nBody: Hi, this is a test email.',
    });
    const call = await startCall(s);
    await speech('continuation-name', 'Call me Taylor. Draft a test email.');
    await vi.waitFor(() =>
      expect(sent.filter((e) => e.type === 'response.create')).toHaveLength(1),
    );
    await emit({
      type: 'response.created',
      response: {
        id: 'continuation',
        status: 'in_progress',
        metadata: { generation: '1', sourceItem: 'continuation-name' },
      },
    });
    await emit({
      type: 'response.function_call_arguments.done',
      response_id: 'continuation',
      call_id: 'continuation-tool',
      name: 'capture_onboarding',
      arguments: JSON.stringify({
        expectedRevision: (await s.read()).body.revision,
        askOnboarding: true,
        changes: [],
        preferences: [],
      }),
    });
    await emit({
      type: 'response.done',
      response: { id: 'continuation', status: 'completed' },
    });
    await vi.waitFor(() =>
      expect(sent.filter((e) => e.type === 'response.create')).toHaveLength(2),
    );
    expect(
      sent.filter((e) => e.type === 'response.create').at(-1),
    ).toMatchObject({
      response: {
        tool_choice: 'none',
        instructions: expect.stringContaining('Subject: Test email'),
      },
    });
    await call.end();
  });
  it('delivers useful work before setup and preserves current-plan approval with a prefixed draft', async () => {
    const s = await session();
    const assistance =
      'Subject: Test email\n\nBody: Hey bro, this is a test email.';
    command = {
      assistance,
      intake: {
        ...blank(),
        tasks: [
          { value: 'draft a test email', evidence: 'draft a test email' },
        ],
      },
    };
    const first = await s.send('Please draft a test email.');
    expect(first.body.turns.at(-1).content).toContain(assistance);
    expect(first.body.onboarding.facts.userName.value).toBeNull();
    expect(first.body.journey.entered).toBe(false);
    await db.query(
      'UPDATE conversations SET gmail_verified_at=now() WHERE id=$1',
      [s.id],
    );
    command = {
      changes: names,
      assistance,
      intake: { ...blank(), plan: ['Review the test email draft.'] },
    };
    const next = await s.send(
      'Call yourself Atom. I am Ashwin. Show the draft again.',
    );
    expect(next.body.turns.at(-1).content).toMatch(/^Subject: Test email/);
    expect(next.body.onboarding.intake.plan.presented).toBe(true);
    command = {
      assistance: 'What subject and body would you like?',
      intake: {
        ...blank(),
        acceptPlan: {
          id: next.body.onboarding.intake.plan.id,
          evidence: 'Yes',
        },
      },
    };
    const accepted = (await s.send('Yes.')).body;
    expect(accepted.journey.entered).toBe(true);
    expect(accepted.onboarding.lastResult).toBe(assistance);
    expect(accepted.turns.at(-1).content).not.toContain('subject and body');
  });
  it('preserves known tasks and identity when a follow-up repeats stale proposals', async () => {
    const { s } = await ready();
    command = {
      changes: [
        {
          goal: 'userName',
          action: 'set',
          value: 'Ashwin',
          evidence: 'I am Ashwin',
        },
      ],
      assistance: 'Here is the grocery list: milk, bread and eggs.',
      intake: {
        ...blank(),
        tasks: [{ value: tasks[0].value, evidence: 'old unavailable quote' }],
        replaceTasks: true,
      },
    };
    const response = await s.send('Just show the list.');
    expect(response.body.onboarding.intake.tasks).toEqual(
      tasks.map((t) => t.value),
    );
    expect(response.body.onboarding.facts.userName.value).toBe('Ashwin');
    expect(response.body.turns.at(-1).content).toContain(
      'milk, bread and eggs',
    );
    expect(response.body.turns.at(-1).content).not.toContain(
      'Does this plan work for you?',
    );
    expect(response.body.onboarding.lastResult).toContain(
      'milk, bread and eggs',
    );
  });
  it('does not erase tasks when a no-task proposal only quotes another goal refusal', async () => {
    const { s } = await ready();
    command = {
      preferences: [
        { goal: 'voice', outcome: 'declined', evidence: 'No call, thanks.' },
      ],
      intake: { ...blank(), noTasksEvidence: 'No call, thanks.' },
    };
    const response = await s.send('No call, thanks.');
    expect(response.body.onboarding.intake.tasks).toEqual(
      tasks.map((t) => t.value),
    );
    expect(response.body.onboarding.intake.noTasks).toBe(false);
  });
  it('automatically repairs a rejected speech capture once before offering manual retry', async () => {
    const s = await session();
    let attempts = 0;
    voiceCommand = (input) => {
      attempts++;
      return spokenName(input, attempts === 1 ? 'Invented' : 'Taylor');
    };
    const call = await startCall(s);
    await speech('repair-evidence', 'Call me Taylor.');
    await vi.waitFor(async () =>
      expect((await s.read()).body.onboarding.facts.userName.value).toBe(
        'Taylor',
      ),
    );
    expect(attempts).toBe(2);
    expect(JSON.stringify(sent)).not.toContain('Retry saved speech');
    await call.end();
  });
});
