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
import { migrate } from '../src/chat/migration.js';
import type { CaptureResult } from '../src/chat/onboarding.js';
import { invitedAccount } from './invited-account.js';

describe('bounded onboarding', () => {
  let app: INestApplication;
  let postgres: PGlite;
  let db: Database;
  let command: Record<string, unknown>;
  let captured: CaptureResult;
  let failReply = false;
  const origin = 'https://persona.example';
  const model: ReplyModel = {
    reply: async (_turns, tools) => {
      captured = await tools.capture({
        expectedRevision: tools.state.revision,
        askOnboarding: true,
        changes: [],
        preferences: [],
        exitEvidence: null,
        ...command,
      });
      if (failReply) {
        failReply = false;
        throw new Error('PROVIDER_UNAVAILABLE');
      }
      return (
        captured.question ??
        (captured.state.graduated ? 'Let us begin.' : 'Saved your preferences.')
      );
    },
  };
  beforeAll(async () => {
    postgres = new PGlite();
    db = {
      query: (sql, values) => postgres.query(sql, values),
      transaction: (work) => postgres.transaction((tx) => work(tx)),
    };
    await migrate(db);
    const module = await Test.createTestingModule({ imports: [ChatModule] })
      .overrideProvider(DATABASE)
      .useValue(db)
      .overrideProvider(MODEL)
      .useValue(model)
      .overrideProvider(GMAIL_PROVIDER)
      .useValue({ available: () => true })
      .overrideProvider(TOKEN_KEY)
      .useValue(Buffer.alloc(32, 1).toString('base64'))
      .overrideProvider(CHAT_CONFIG)
      .useValue({ origins: [origin], secureCookies: true })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    await postgres.close();
  });
  beforeEach(() => {
    command = {};
    failReply = false;
  });
  async function session() {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(await invitedAccount(app))
      .expect(200);
    const cookie = login.headers['set-cookie'][0];
    return {
      id: login.body.conversationId as string,
      send: (content: string, submissionId = randomUUID()) =>
        request(app.getHttpServer())
          .post('/turns')
          .set('Origin', origin)
          .set('X-Persona-Client', 'web')
          .set('Cookie', cookie)
          .send({ content, submissionId })
          .expect(200),
      read: () =>
        request(app.getHttpServer())
          .get('/session')
          .set('Cookie', cookie)
          .expect(200),
    };
  }
  const allFacts = [
    {
      goal: 'agentName',
      action: 'set',
      value: 'Nova',
      evidence: 'Call yourself Nova',
    },
    {
      goal: 'userName',
      action: 'set',
      value: 'Ashwin',
      evidence: 'I am Ashwin',
    },
    {
      goal: 'helpRequest',
      action: 'set',
      value: 'prepare for my interview',
      evidence: 'Help me prepare for my interview',
    },
  ];
  const introduction =
    'Call yourself Nova. I am Ashwin. Help me prepare for my interview.';

  it('prepares a task, attempts voice and Gmail once, then preserves incomplete setup in main', async () => {
    const s = await session();
    command = { changes: allFacts };
    const first = await s.send(introduction);
    expect(captured.state.mode).toBe('onboarding');
    expect(captured.permittedGoal).toBe('voice');
    expect(first.body.onboarding.mode).toBe('onboarding');
    expect(first.body.onboarding.policy.goals.voice).toMatchObject({
      introduced: true,
      outcome: 'open',
    });
    command = {};
    const next = await s.send('Okay.');
    expect(captured.permittedGoal).toBe('gmail');
    expect(next.body.onboarding).toMatchObject({
      graduated: true,
      mode: 'helping',
      onboardingComplete: false,
      gmail: 'not_connected',
    });
    expect(next.body.onboarding.policy.goals.gmail.outcome).toBe('open');
    await s.send('Let us practice the introduction.');
    expect(captured.question).toBeNull();
    await migrate(db);
    expect((await s.read()).body.onboarding.mode).toBe('helping');
  });

  it('distinguishes a deferred goal from leaving setup without a first task', async () => {
    const s = await session();
    command = {
      askOnboarding: false,
      preferences: [
        { goal: 'gmail', outcome: 'deferred', evidence: 'Gmail later' },
      ],
    };
    expect((await s.send('Gmail later.')).body.onboarding.mode).toBe(
      'onboarding',
    );
    command = { askOnboarding: false, exitEvidence: 'Skip all of this' };
    const result = await s.send('Skip all of this. I do not need help yet.');
    expect(result.body.onboarding).toMatchObject({
      mode: 'helping',
      graduated: true,
      onboardingComplete: false,
      facts: { helpRequest: { value: null } },
    });
    expect(result.body.onboarding.policy.goals.gmail.outcome).toBe('deferred');
    expect((await s.read()).body.onboarding.mode).toBe('helping');
  });

  it('rejects forged exit evidence and mode writes without mutating the phase', async () => {
    const s = await session();
    command = { exitEvidence: 'Skip setup' };
    await s.send('Hello.');
    expect(captured.code).toBe('invalid');
    command = { mode: 'helping' };
    await s.send('Hello again.');
    expect(captured.code).toBe('invalid');
    expect((await s.read()).body.onboarding.mode).toBe('onboarding');
  });

  it('retains a failed invitation for retry and counts it only when the reply commits', async () => {
    const s = await session();
    const submission = randomUUID();
    command = { changes: allFacts };
    failReply = true;
    const failed = await s.send(introduction, submission);
    expect(failed.body.operation.status).toBe('failed');
    expect(failed.body.onboarding.policy.goals.voice).toMatchObject({
      introduced: false,
      eligible: true,
    });
    await migrate(db);
    expect((await s.read()).body.onboarding.graduated).toBe(false);
    const retry = await s.send(introduction, submission);
    expect(captured.code).toBe('already_applied');
    expect(retry.body.onboarding.policy.goals.voice.introduced).toBe(true);
    expect(retry.body.turns).toHaveLength(3);
    const events = await db.query(
      'SELECT id FROM onboarding_facts WHERE conversation_id=$1',
      [s.id],
    );
    expect(events.rows).toHaveLength(3);
  });

  it('keeps an explicit exit through reply failure and retry without reopening intake', async () => {
    const s = await session();
    const submission = randomUUID();
    command = { askOnboarding: false, exitEvidence: 'Skip setup' };
    failReply = true;
    expect((await s.send('Skip setup.', submission)).body.onboarding.mode).toBe(
      'helping',
    );
    await s.send('Skip setup.', submission);
    expect(captured.code).toBe('already_applied');
    expect(captured.question).toBeNull();
    expect(captured.state.onboardingComplete).toBe(false);
  });

  it('rechecks integration state before replaying a failed invitation', async () => {
    const s = await session();
    command = { changes: allFacts };
    await s.send(introduction);
    command = {};
    failReply = true;
    const submission = randomUUID();
    await s.send('Continue setup.', submission);
    expect(captured.permittedGoal).toBe('gmail');
    await db.query(
      'UPDATE conversations SET gmail_verified_at=now() WHERE id=$1',
      [s.id],
    );
    const retry = await s.send('Continue setup.', submission);
    expect(captured.code).toBe('already_applied');
    expect(captured.question).toBeNull();
    expect(retry.body.onboarding).toMatchObject({
      mode: 'helping',
      onboardingComplete: true,
      gmail: 'connected',
    });
  });
});
