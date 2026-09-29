import { invitedAccount } from './invited-account.js';
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { streamText } from './fake-responses.js';
import { OpenAIReplyModel } from '../src/chat/model.js';
import { ChatModule } from '../src/chat/chat.module.js';
import { DATABASE, type Database } from '../src/chat/database.js';
import { MODEL, type ReplyModel } from '../src/chat/model.js';
import { CHAT_CONFIG } from '../src/chat/config.js';
import { CLOCK } from '../src/chat/authority.js';
import { migrate } from '../src/chat/migration.js';

describe('saved conversation API', () => {
  let app: INestApplication;
  let postgres: PGlite;
  let db: Database;
  const model: ReplyModel = {
    reply: async () => 'Let us practice your introduction.',
  };
  const origin = 'https://persona.example';
  let now = Date.now();

  beforeEach(async () => {
    now = Date.now();
    model.reply = async () => 'Let us practice your introduction.';
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
      .overrideProvider(CLOCK)
      .useValue(() => now)
      .overrideProvider(CHAT_CONFIG)
      .useValue({ origins: [origin], secureCookies: true })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    await postgres.close();
  });

  it('persists refusal and deferral, ignores refresh, and reopens only explicitly', async () => {
    model.reply = async (turns, tools) => {
      const text = turns.at(-1)!.content;
      const preferences = text.includes('no Gmail')
        ? [
            { goal: 'gmail', outcome: 'declined', evidence: 'no Gmail' },
            { goal: 'voice', outcome: 'deferred', evidence: 'voice later' },
          ]
        : text.includes('connect Gmail')
          ? [{ goal: 'gmail', outcome: 'open', evidence: 'connect Gmail' }]
          : [];
      const result = await tools.capture({
        expectedRevision: tools.state.revision,
        askOnboarding: false,
        changes: [],
        preferences,
      });
      expect(result.ok).toBe(true);
      return 'We can keep working here.';
    };
    const cookie = await newSession();
    const first = await send(cookie, 'no Gmail, voice later').expect(200);
    const visit = first.body.onboarding.policy.visitId;
    expect(first.body.onboarding.policy.goals.gmail).toMatchObject({
      outcome: 'declined',
      eligible: false,
    });
    expect(first.body.onboarding.policy.goals.voice).toMatchObject({
      outcome: 'deferred',
      eligible: false,
    });
    now += 1800001;
    const refreshed = await request(app.getHttpServer())
      .get('/session')
      .set('Cookie', cookie)
      .expect(200);
    expect(refreshed.body.onboarding.policy.visitId).toBe(visit);
    const next = await send(cookie, 'Continue helping me.').expect(200);
    expect(next.body.onboarding.policy.visitId).not.toBe(visit);
    expect(next.body.onboarding.policy.goals.gmail.eligible).toBe(false);
    expect(next.body.onboarding.policy.goals.voice.eligible).toBe(true);
    const reopened = await send(cookie, 'connect Gmail').expect(200);
    expect(reopened.body.onboarding.policy.goals.gmail).toMatchObject({
      outcome: 'open',
      eligible: false,
    });
    expect(reopened.body.onboarding.gmailAvailable).toBe(false);
  });

  it('keeps another tab read-only until explicit takeover and rejects stale writes', async () => {
    const cookie = await newSession();
    const a = randomUUID();
    const b = randomUUID();
    const control = (tabId: string, takeover = false) =>
      request(app.getHttpServer())
        .post('/control')
        .set('Origin', origin)
        .set('X-Persona-Client', 'web')
        .set('Cookie', cookie)
        .send({ tabId, takeover });
    const first = await control(a).expect(200);
    expect(first.body.control.tabId).toBe(a);
    const other = await control(b).expect(200);
    expect(other.body.control.tabId).toBe(a);
    const taken = await control(b, true).expect(200);
    expect(taken.body.control.tabId).toBe(b);
    expect(taken.body.control.epoch).toBeGreaterThan(first.body.control.epoch);
    await send(cookie, 'A bypass without ownership').expect(403);
    await send(cookie, 'A stale tab write')
      .set('X-Persona-Tab', a)
      .set('X-Persona-Epoch', String(first.body.control.epoch))
      .expect(403);
    const reply = await send(cookie, 'Help me from the controlling tab')
      .set('X-Persona-Tab', b)
      .set('X-Persona-Epoch', String(taken.body.control.epoch))
      .expect(200);
    expect(reply.body.turns).toHaveLength(3);
  });

  it('commits all volunteered facts before the reply and restores early graduation', async () => {
    const content =
      "Call yourself Nova. I'm Ashwin. Help me prepare for a backend interview.";
    model.reply = async (_turns, tools) => {
      const result = await tools.capture({
        expectedRevision: tools.state.revision,
        askOnboarding: true,
        changes: [
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
            evidence: "I'm Ashwin",
          },
          {
            goal: 'helpRequest',
            action: 'set',
            value: 'Help me prepare for a backend interview',
            evidence: 'Help me prepare for a backend interview',
          },
        ],
      });
      expect(result.ok).toBe(true);
      expect(result.state.graduated).toBe(true);
      expect(result.state.onboardingComplete).toBe(false);
      expect(result.question).toContain('Would you like to talk');
      return 'Ashwin, start by explaining how you would design an API.';
    };
    const session = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(await invitedAccount(app))
      .expect(200);
    const cookie = session.headers['set-cookie'][0];
    await request(app.getHttpServer())
      .post('/turns')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .set('Cookie', cookie)
      .send({ submissionId: randomUUID(), content })
      .expect(200);
    const restored = await request(app.getHttpServer())
      .get('/session')
      .set('Cookie', cookie)
      .expect(200);
    expect(restored.body.onboarding).toMatchObject({
      mode: 'helping',
      graduated: true,
      onboardingComplete: false,
      gmail: 'not_connected',
      call: 'not_started',
      facts: {
        agentName: { value: 'Nova', status: 'known' },
        userName: { value: 'Ashwin', status: 'known' },
      },
    });
    expect(restored.body.onboarding.facts.userName.sourceTurnId).toBe(
      restored.body.turns[1].id,
    );
    expect(restored.body.turns).toHaveLength(3);
  });

  it.each([
    {
      label: 'accepted',
      name: 'Nova',
      evidence: 'Call yourself Nova',
      answer: 'Nova it is.',
      expectedName: 'Nova',
      question:
        'Would you like to talk this through on a call? You can use Start a call whenever you are ready.',
    },
    {
      label: 'rejected',
      name: 'Invented',
      evidence: 'An invented source',
      answer: 'I could not save that name.',
      expectedName: null,
      question: null,
    },
  ])(
    'uses the $label provider tool result before replying',
    async ({ name, evidence, answer, expectedName, question }) => {
      let receivedAuthoritativeState = false;
      const providerReply =
        answer + (question ? ' What is your name? What do you need?' : '');
      const provider = createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        const input = JSON.parse(body);
        const toolOutput = input.input.find(
          (item: { type?: string }) => item.type === 'function_call_output',
        );
        if (toolOutput) {
          receivedAuthoritativeState =
            JSON.parse(toolOutput.output).state.facts.agentName.value ===
            expectedName;
          return streamText(res, providerReply.split(/(?<= )/));
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'resp_capture',
            object: 'response',
            status: 'completed',
            output: [
              {
                type: 'function_call',
                name: 'capture_onboarding',
                call_id: 'call_fact',
                arguments: JSON.stringify({
                  expectedRevision: 1,
                  askOnboarding: true,
                  changes: [
                    {
                      goal: 'agentName',
                      action: 'set',
                      value: name,
                      evidence,
                    },
                  ],
                }),
              },
            ],
          }),
        );
      });
      await new Promise<void>((resolve) =>
        provider.listen(0, '127.0.0.1', resolve),
      );
      const address = provider.address();
      if (!address || typeof address === 'string')
        throw new Error('No provider address');
      const realAdapter = new OpenAIReplyModel(
        'test-key',
        'gpt-4.1-mini',
        `http://127.0.0.1:${address.port}/v1`,
      );
      model.reply = realAdapter.reply.bind(realAdapter);
      try {
        const session = await request(app.getHttpServer())
          .post('/auth/login')
          .set('Origin', origin)
          .set('X-Persona-Client', 'web')
          .send(await invitedAccount(app));
        const reply = await request(app.getHttpServer())
          .post('/turns')
          .set('Origin', origin)
          .set('X-Persona-Client', 'web')
          .set('Cookie', session.headers['set-cookie'][0])
          .send({ submissionId: randomUUID(), content: 'Call yourself Nova.' })
          .expect(200);
        expect(receivedAuthoritativeState).toBe(true);
        expect(reply.body.turns[2].content).toBe(
          [answer, question].filter(Boolean).join('\n\n'),
        );
        expect(reply.body.onboarding.facts.agentName.value).toBe(expectedName);
      } finally {
        await new Promise<void>((resolve, reject) =>
          provider.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );

  async function newSession() {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(await invitedAccount(app))
      .expect(200);
    return response.headers['set-cookie'][0];
  }
  function send(cookie: string, content: string, submissionId = randomUUID()) {
    return request(app.getHttpServer())
      .post('/turns')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .set('Cookie', cookie)
      .send({ submissionId, content });
  }

  it('keeps an accepted name during ambiguity and uses an explicit correction with new provenance', async () => {
    const cookie = await newSession();
    const capture = (
      action: string,
      value: string | null,
      evidence: string,
    ) => {
      model.reply = async (_turns, tools) => {
        const result = await tools.capture({
          expectedRevision: tools.state.revision,
          askOnboarding: true,
          changes: [{ goal: 'userName', action, value, evidence }],
        });
        if (!result.ok) throw new Error('Rejected fact');
        return result.question ?? 'Ready to help.';
      };
    };
    capture('set', 'Alex', 'I am Alex');
    const first = await send(cookie, 'I am Alex.').expect(200);
    const original = first.body.onboarding.facts.userName;
    capture('clarify', null, 'Maybe Sam or Jordan');
    const ambiguous = await send(cookie, 'Maybe Sam or Jordan.').expect(200);
    expect(ambiguous.body.onboarding.facts.userName).toEqual({
      ...original,
      status: 'ambiguous',
    });
    expect(ambiguous.body.turns.at(-1).content).toBe(
      'What name would you like me to use for you?',
    );
    model.reply = async (_turns, tools) => {
      const result = await tools.capture({
        expectedRevision: tools.state.revision,
        askOnboarding: false,
        changes: [
          {
            goal: 'helpRequest',
            action: 'set',
            value: 'Help me prepare for my interview',
            evidence: 'Help me prepare for my interview',
          },
        ],
      });
      expect(result.ok).toBe(true);
      expect(result.question).toBeNull();
      return 'Start with a 60-second introduction.';
    };
    const deferred = await send(
      cookie,
      'Leave my name for now. Help me prepare for my interview.',
    ).expect(200);
    expect(deferred.body.onboarding.mode).toBe('helping');
    expect(deferred.body.onboarding.facts.userName).toEqual({
      ...original,
      status: 'ambiguous',
    });
    expect(deferred.body.turns.at(-1).content).toBe(
      'Start with a 60-second introduction.',
    );
    capture('correct', 'Sam', 'Actually, call me Sam');
    const corrected = await send(cookie, 'Actually, call me Sam.').expect(200);
    expect(corrected.body.onboarding.facts.userName).toMatchObject({
      value: 'Sam',
      status: 'known',
      sourceTurnId: corrected.body.turns[7].id,
    });
    expect(corrected.body.onboarding.facts.userName.revision).toBeGreaterThan(
      original.revision,
    );
    const restored = await request(app.getHttpServer())
      .get('/session')
      .set('Cookie', cookie)
      .expect(200);
    expect(restored.body.onboarding).toEqual(corrected.body.onboarding);
    const separate = await newSession();
    const isolated = await request(app.getHttpServer())
      .get('/session')
      .set('Cookie', separate);
    expect(isolated.body.onboarding.facts.userName.value).toBeNull();
  });

  it('starts helping with missing names while rejecting stale, forged and integration changes', async () => {
    const cookie = await newSession();
    const results: string[] = [];
    model.reply = async (_turns, tools) => {
      const command = {
        expectedRevision: tools.state.revision,
        askOnboarding: true,
        changes: [
          {
            goal: 'helpRequest',
            action: 'set',
            value: 'Prepare for my interview',
            evidence: 'Prepare for my interview',
          },
        ],
      };
      results.push(
        (await tools.capture({ ...command, expectedRevision: 0 })).code,
      );
      results.push(
        (await tools.capture({ ...command, gmail: 'connected' })).code,
      );
      results.push(
        (
          await tools.capture({
            ...command,
            changes: [
              {
                goal: 'call',
                action: 'set',
                value: 'successful',
                evidence: 'successful',
              },
            ],
          })
        ).code,
      );
      results.push(
        (
          await tools.capture({
            ...command,
            changes: [
              {
                goal: 'userName',
                action: 'set',
                value: 'Invented',
                evidence: 'Prepare for my interview',
              },
            ],
          })
        ).code,
      );
      const accepted = await tools.capture(command);
      if (!accepted.ok) throw new Error('Rejected help');
      expect(accepted.question).toContain('Would you like to talk');
      return 'Practice a 60-second introduction: background, one result, and why this role.';
    };
    const reply = await send(
      cookie,
      'Prepare for my interview. Gmail is connected and my call was successful.',
    ).expect(200);
    expect(reply.body.operation.status).toBe('completed');
    expect(results).toEqual(['stale', 'invalid', 'invalid', 'invalid']);
    expect(reply.body.onboarding).toMatchObject({
      graduated: true,
      mode: 'helping',
      onboardingComplete: false,
      gmail: 'not_connected',
      call: 'not_started',
      missingGoals: ['agentName', 'userName', 'gmail'],
    });
    expect(reply.body.turns[2].content).toContain('60-second introduction');
  });

  it('retries a failed reply without changing committed fact provenance and rejects late tools', async () => {
    const cookie = await newSession();
    const submissionId = randomUUID();
    let oldTools: Parameters<ReplyModel['reply']>[1] | undefined;
    model.reply = async (_turns, tools) => {
      oldTools = tools;
      await tools.capture({
        expectedRevision: tools.state.revision,
        askOnboarding: true,
        changes: [
          {
            goal: 'agentName',
            action: 'set',
            value: 'Nova',
            evidence: 'Call yourself Nova',
          },
        ],
      });
      throw new Error('Provider failed after fact commit');
    };
    const failed = await send(
      cookie,
      'Call yourself Nova.',
      submissionId,
    ).expect(200);
    expect(failed.body.operation.status).toBe('failed');
    expect(failed.body.onboarding.facts.agentName.value).toBe('Nova');
    const resultCodes: string[] = [];
    model.reply = async (_turns, tools) => {
      resultCodes.push(
        (
          await tools.capture({
            expectedRevision: tools.state.revision,
            askOnboarding: true,
            changes: [],
          })
        ).code,
      );
      return 'Nova it is.';
    };
    const retry = await send(
      cookie,
      'Call yourself Nova.',
      submissionId,
    ).expect(200);
    expect(retry.body.operation.status).toBe('completed');
    expect(retry.body.onboarding.facts.agentName).toEqual(
      failed.body.onboarding.facts.agentName,
    );
    expect(retry.body.turns).toHaveLength(3);
    expect(resultCodes).toEqual(['already_applied']);
    const late = await oldTools!.capture({
      expectedRevision: retry.body.revision,
      askOnboarding: true,
      changes: [],
    });
    expect(late.ok).toBe(false);
    expect(late.code).toBe('stale');
  });

  it('saves a real exchange and restores it using only the browser credential', async () => {
    const session = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(await invitedAccount(app))
      .expect(200);
    const cookie = session.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    const submissionId = randomUUID();
    await request(app.getHttpServer())
      .post('/turns')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .set('Cookie', cookie)
      .send({ submissionId, content: 'Help me prepare for an interview.' })
      .expect(200);
    const restored = await request(app.getHttpServer())
      .get('/session')
      .set('Cookie', cookie)
      .expect(200);
    expect(
      restored.body.turns.map((turn: { content: string }) => turn.content),
    ).toEqual([
      "Hi, I'm Persona. What would you like to call me?",
      'Help me prepare for an interview.',
      'Let us practice your introduction.',
    ]);
    await request(app.getHttpServer()).get('/session').expect(401);
  });

  it('replays a committed submission after a lost acknowledgement without generating another reply', async () => {
    const session = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(await invitedAccount(app));
    const cookie = session.headers['set-cookie'][0];
    const payload = { submissionId: randomUUID(), content: 'Help me prepare.' };
    const send = () =>
      request(app.getHttpServer())
        .post('/turns')
        .set('Origin', origin)
        .set('X-Persona-Client', 'web')
        .set('Cookie', cookie)
        .send(payload);
    await send().expect(200); // The browser never receives this acknowledgement.
    model.reply = async () => {
      throw new Error('A committed replay must not need the provider.');
    };
    const replay = await send().expect(200);
    expect(
      replay.body.turns.map((turn: { role: string }) => turn.role),
    ).toEqual(['assistant', 'user', 'assistant']);
    expect(replay.body.operation.status).toBe('completed');
  });

  it('keeps a failed reply retryable without duplicating the saved user message', async () => {
    const session = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(await invitedAccount(app));
    const cookie = session.headers['set-cookie'][0];
    const payload = { submissionId: randomUUID(), content: 'Prepare me.' };
    const send = () =>
      request(app.getHttpServer())
        .post('/turns')
        .set('Origin', origin)
        .set('X-Persona-Client', 'web')
        .set('Cookie', cookie)
        .send(payload);
    model.reply = async () => {
      throw new Error('Provider unavailable');
    };
    const failed = await send().expect(200);
    expect(failed.body.operation.status).toBe('failed');
    expect(failed.body.turns).toHaveLength(2);
    model.reply = async () => 'We can try again.';
    const retried = await send().expect(200);
    expect(
      retried.body.turns.map((t: { content: string }) => t.content),
    ).toEqual([
      "Hi, I'm Persona. What would you like to call me?",
      'Prepare me.',
      'We can try again.',
    ]);
  });

  it('serializes concurrent submissions and rejects conflicting reuse of an identifier', async () => {
    const session = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(await invitedAccount(app));
    const cookie = session.headers['set-cookie'][0];
    const payload = { submissionId: randomUUID(), content: 'One request.' };
    let finish!: (reply: string) => void;
    let started!: () => void;
    const isStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    model.reply = () => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const send = (body: object) =>
      request(app.getHttpServer())
        .post('/turns')
        .set('Origin', origin)
        .set('X-Persona-Client', 'web')
        .set('Cookie', cookie)
        .send(body);
    const first = send(payload).then((response) => response);
    await isStarted;
    const duplicate = await send(payload).expect(200);
    expect(duplicate.body.operation.status).toBe('generating');
    expect(duplicate.body.turns).toHaveLength(2);
    await send({ ...payload, content: 'Different request.' }).expect(409);
    await send({
      submissionId: randomUUID(),
      content: 'A second request.',
    }).expect(409);
    finish('One reply.');
    expect((await first).body.turns).toHaveLength(3);
  });

  it('rejects cross-origin writes and credentials from another conversation', async () => {
    await request(app.getHttpServer())
      .post('/session')
      .set('Origin', 'https://hostile.example')
      .set('X-Persona-Client', 'web')
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post('/session')
      .set('Origin', origin)
      .send({})
      .expect(403);
    const create = async () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .set('Origin', origin)
        .set('X-Persona-Client', 'web')
        .send(await invitedAccount(app));
    const first = await create();
    await request(app.getHttpServer())
      .post('/turns')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .set('Cookie', first.headers['set-cookie'][0])
      .send({ submissionId: randomUUID(), content: 'Private conversation.' })
      .expect(200);
    const second = await create();
    const isolated = await request(app.getHttpServer())
      .get('/session')
      .set('Cookie', second.headers['set-cookie'][0])
      .query({ conversationId: first.body.conversationId })
      .expect(200);
    expect(isolated.body.turns).toMatchObject([{ kind: 'opening' }]);
    await request(app.getHttpServer())
      .get('/session')
      .set('Cookie', 'persona_session=invalid')
      .expect(401);
  });

  it('reports database outages without acknowledging a message as saved', async () => {
    const session = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(await invitedAccount(app));
    const query = db.query.bind(db);
    db.query = async () => {
      throw new Error('Database unavailable with sensitive connection details');
    };
    await request(app.getHttpServer())
      .get('/ready')
      .expect(503)
      .expect({ code: 'SERVICE_UNAVAILABLE' });
    const payload = {
      submissionId: randomUUID(),
      content: 'Wait for my connection.',
    };
    const send = () =>
      request(app.getHttpServer())
        .post('/turns')
        .set('Origin', origin)
        .set('X-Persona-Client', 'web')
        .set('Cookie', session.headers['set-cookie'][0])
        .send(payload);
    await send().expect(503).expect({ code: 'SERVICE_UNAVAILABLE' });
    db.query = query;
    await request(app.getHttpServer())
      .get('/ready')
      .expect(200)
      .expect({ ready: true });
    expect((await send().expect(200)).body.turns).toHaveLength(3);
  });
});
