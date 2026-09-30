import { invitedAccount } from './invited-account.js';
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ChatModule } from '../src/chat/chat.module.js';
import { DATABASE, type Database } from '../src/chat/database.js';
import { MODEL, type ModelTurn, type ReplyModel } from '../src/chat/model.js';
import { CHAT_CONFIG } from '../src/chat/config.js';
import { CLOCK } from '../src/chat/authority.js';
import { migrate } from '../src/chat/migration.js';
import { FACT_REPAIR, type FactRepair } from '../src/chat/fact-repair.js';
import {
  CALL_RECAP,
  type CallRecap,
  type RecapInput,
} from '../src/chat/call-recap.js';
import {
  VOICE_PROVIDER,
  type VoiceEvent,
  type VoiceProvider,
} from '../src/chat/voice-provider.js';

describe('browser call API', () => {
  let app: INestApplication;
  let postgres: PGlite;
  let now = Date.now();
  const origin = 'https://persona.example';
  let textContext: ModelTurn[] = [];
  let failOpeningContext = false;
  const model: ReplyModel = { reply: async () => 'Ready to help in text.' };
  const repair: FactRepair = {
    interpret: async () => {
      throw new Error('REPAIR_UNAVAILABLE');
    },
  };
  const recap: CallRecap = {
    write: async () => {
      throw new Error('RECAP_UNAVAILABLE');
    },
  };
  let recapInputs: RecapInput[] = [];
  const connections: {
    emit: (event: VoiceEvent) => Promise<void>;
    disconnect: () => void;
    sent: Record<string, unknown>[];
    closed: boolean;
    stalled: boolean;
    instructions: string;
  }[] = [];
  const provider: VoiceProvider = {
    connect: async (_sdp, _instructions, onEvent, onClose) => {
      const c = {
        emit: onEvent,
        disconnect: onClose,
        sent: [] as Record<string, unknown>[],
        closed: false,
        stalled: false,
        instructions: _instructions,
      };
      connections.push(c);
      return {
        healthy: () => !c.closed && !c.stalled,
        providerId: 'rtc_test' + connections.length,
        sdp: 'v=0\r\nanswer',
        send: (event) => {
          c.sent.push(event);
        },
        close: async () => {
          c.closed = true;
        },
      };
    },
  };
  beforeAll(async () => {
    postgres = new PGlite();
    const db: Database = {
      query: (s, v) => postgres.query(s, v),
      transaction: (work) =>
        postgres.transaction((sql) =>
          work({
            query: (statement, values) => {
              if (
                failOpeningContext &&
                statement.startsWith('SELECT id,role,content,created_at')
              ) {
                failOpeningContext = false;
                throw new Error('CONTEXT_UNAVAILABLE');
              }
              return sql.query(statement, values);
            },
          }),
        ),
    };
    await migrate(db);
    const module = await Test.createTestingModule({ imports: [ChatModule] })
      .overrideProvider(DATABASE)
      .useValue(db)
      .overrideProvider(MODEL)
      .useValue(model)
      .overrideProvider(CHAT_CONFIG)
      .useValue({ origins: [origin], secureCookies: true })
      .overrideProvider(CLOCK)
      .useValue(() => now)
      .overrideProvider(VOICE_PROVIDER)
      .useValue(provider)
      .overrideProvider(FACT_REPAIR)
      .useValue(repair)
      .overrideProvider(CALL_RECAP)
      .useValue(recap)
      .compile();
    app = module.createNestApplication();
    await app.init();
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await postgres?.close();
  });
  beforeEach(() => {
    now = Date.now();
    failOpeningContext = false;
    repair.interpret = async () => {
      throw new Error('REPAIR_UNAVAILABLE');
    };
    model.reply = async (turns) => {
      textContext = turns;
      return 'Ready to help in text.';
    };
    recapInputs = [];
    recap.write = async () => {
      throw new Error('RECAP_UNAVAILABLE');
    };
  });
  async function speak(
    c: (typeof connections)[number],
    assistant: string,
    user: string,
  ) {
    await c.emit({
      type: 'response.created',
      response: {
        id: 'opening-response',
        status: 'in_progress',
        metadata: { generation: '0', purpose: 'opening' },
      },
    });
    await c.emit({
      type: 'response.output_audio_transcript.done',
      item_id: 'opening-audio',
      response_id: 'opening-response',
      transcript: assistant,
    });
    await c.emit({
      type: 'output_audio_buffer.stopped',
      response_id: 'opening-response',
    });
    await c.emit({
      type: 'conversation.item.created',
      item: { id: 'user-speech', type: 'message', role: 'user' },
    });
    await c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'user-speech',
      transcript: user,
    });
  }
  async function session() {
    const created = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(await invitedAccount(app))
      .expect(200);
    const cookie = created.headers['set-cookie'][0];
    const tabId = randomUUID();
    const claim = await request(app.getHttpServer())
      .post('/control')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .set('Cookie', cookie)
      .send({ tabId, takeover: false })
      .expect(200);
    const post = (path: string, body: object) =>
      request(app.getHttpServer())
        .post(path)
        .set('Origin', origin)
        .set('X-Persona-Client', 'web')
        .set('Cookie', cookie)
        .set('X-Persona-Tab', tabId)
        .set('X-Persona-Epoch', String(claim.body.control.epoch))
        .send(body);
    const read = () =>
      request(app.getHttpServer())
        .get('/session')
        .set('Cookie', cookie)
        .expect(200);
    const status = () =>
      request(app.getHttpServer())
        .get('/calls/status')
        .set('Cookie', cookie)
        .expect(200);
    return {
      cookie,
      post,
      read,
      status,
      heartbeat: () => post('/control', { tabId, takeover: false }).expect(200),
    };
  }
  it('queues the tagged handoff after playback and preserves the call on dashboard entry', async () => {
    const s = await session(),
      id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    await c.emit({
      type: 'response.created',
      response: {
        id: 'last-question',
        status: 'in_progress',
        metadata: { generation: '0' },
      },
    });
    await c.emit({
      type: 'response.output_audio_transcript.done',
      response_id: 'last-question',
      item_id: 'last-question-item',
      transcript: 'Would you like to connect Gmail?',
    });
    const prepared = await s.post('/journey', { action: 'skip' }).expect(200);
    expect(prepared.body.journey.delivery).toBe('waiting');
    const handoffs = () =>
      c.sent.filter(
        (e) =>
          e.type === 'response.create' &&
          (e.response as { metadata?: { purpose?: string } }).metadata
            ?.purpose === 'onboarding_handoff',
      );
    expect(handoffs()).toHaveLength(0);
    await c.emit({
      type: 'response.done',
      response: { id: 'last-question', status: 'completed' },
    });
    expect(handoffs()).toHaveLength(0);
    await c.emit({
      type: 'output_audio_buffer.stopped',
      response_id: 'last-question',
    });
    expect(handoffs()).toHaveLength(1);
    expect(
      (handoffs()[0].response as { instructions: string }).instructions,
    ).toContain('You can bring your first task');
    await c.emit({
      type: 'response.created',
      response: {
        id: 'handoff',
        status: 'in_progress',
        metadata: { generation: '0', purpose: 'onboarding_handoff' },
      },
    });
    await c.emit({
      type: 'response.done',
      response: { id: 'handoff', status: 'completed' },
    });
    expect((await s.read()).body.journey.delivery).toBe('waiting');
    await c.emit({
      type: 'output_audio_buffer.stopped',
      response_id: 'last-question',
    });
    expect((await s.read()).body.journey.delivery).toBe('waiting');
    await c.emit({
      type: 'output_audio_buffer.stopped',
      response_id: 'handoff',
    });
    expect((await s.read()).body.journey.delivery).toBe('played');
    await s.post('/journey', { action: 'enter' }).expect(200);
    expect((await s.read()).body.journey.entered).toBe(true);
    expect((await s.status()).body.call.status).toBe('active');
    expect(c.closed).toBe(false);
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
  });

  it('does not treat interrupted handoff audio as a completed acknowledgement', async () => {
    const s = await session(),
      id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    await s.post('/journey', { action: 'skip' }).expect(200);
    await c.emit({
      type: 'response.created',
      response: {
        id: 'interrupted-handoff',
        status: 'in_progress',
        metadata: { generation: '0', purpose: 'onboarding_handoff' },
      },
    });
    await c.emit({
      type: 'input_audio_buffer.speech_started',
      item_id: 'interruption',
    });
    await c.emit({
      type: 'output_audio_buffer.stopped',
      response_id: 'interrupted-handoff',
    });
    expect((await s.read()).body.journey.delivery).toBe('text');
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
  });

  it('sign-out immediately closes the call and rejects the old session', async () => {
    const s = await session();
    await s
      .post('/calls/start', { id: randomUUID(), sdp: 'v=0\r\no=browser' })
      .expect(200);
    const connection = connections.at(-1)!;
    expect(connection.closed).toBe(false);
    await s.post('/auth/logout', {}).expect(200);
    expect(connection.closed).toBe(true);
    await request(app.getHttpServer())
      .get('/session')
      .set('Cookie', s.cookie)
      .expect(401);
    await s
      .post('/calls/start', { id: randomUUID(), sdp: 'v=0\r\no=browser' })
      .expect(401);
  });
  it('speaks first only after browser readiness, and never repeats the opening on retries', async () => {
    const s = await session();
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    expect(
      c.sent.filter((event) => event.type === 'response.create'),
    ).toHaveLength(0);
    await Promise.all([
      s.post('/calls/ready', { id }).expect(200),
      s.post('/calls/ready', { id }).expect(200),
    ]);
    const response = c.sent.filter((event) => event.type === 'response.create');
    expect(response).toHaveLength(1);
    expect(response[0]).toMatchObject({
      response: {
        tool_choice: 'none',
        metadata: { generation: '0', purpose: 'opening' },
        instructions: expect.stringContaining(
          'What name would you like me to use for you?',
        ),
      },
    });
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    await s.post('/calls/ready', { id }).expect(409);
  });

  it('lets early user speech take precedence over the voice opening', async () => {
    const s = await session();
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    await c.emit({
      type: 'input_audio_buffer.speech_started',
      item_id: 'early-speech',
    });
    await s.post('/calls/ready', { id }).expect(200);
    expect(
      c.sent.filter((event) => event.type === 'response.create'),
    ).toHaveLength(0);
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
  });

  it('retries a voice opening after its context lookup fails without consuming the question', async () => {
    const s = await session();
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    failOpeningContext = true;
    await s.post('/calls/ready', { id }).expect(503);
    expect(
      c.sent.filter((event) => event.type === 'response.create'),
    ).toHaveLength(0);
    await s.post('/calls/ready', { id }).expect(200);
    expect(
      c.sent.filter((event) => event.type === 'response.create'),
    ).toMatchObject([
      {
        response: {
          instructions: expect.stringContaining(
            'What name would you like me to use for you?',
          ),
        },
      },
    ]);
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
  });

  it.each(['speech', 'typing', 'hangup'])(
    'keeps an opening interrupted by %s out of heard context despite late events',
    async (action) => {
      const s = await session();
      const id = randomUUID();
      await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
      await s.post('/calls/ready', { id }).expect(200);
      const c = connections.at(-1)!;
      await c.emit({
        type: 'response.created',
        response: {
          id: 'opening-response',
          status: 'in_progress',
          metadata: { generation: '0', purpose: 'opening' },
        },
      });
      if (action === 'speech')
        await c.emit({
          type: 'input_audio_buffer.speech_started',
          item_id: 'interrupting-speech',
        });
      else if (action === 'typing')
        await s
          .post('/calls/turns', {
            id,
            submissionId: randomUUID(),
            content: 'Help me with an interview instead.',
          })
          .expect(200);
      else
        await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
      await c.emit({
        type: 'response.output_audio_transcript.done',
        item_id: 'opening-audio',
        response_id: 'opening-response',
        transcript: 'An opening that was interrupted.',
      });
      await c.emit({
        type: 'output_audio_buffer.stopped',
        response_id: 'opening-response',
      });
      const saved = await s.read();
      expect(saved.body.onboarding.policy.goals.userName.introduced).toBe(
        false,
      );
      expect(
        saved.body.turns.find(
          (turn: { content: string }) =>
            turn.content === 'An opening that was interrupted.',
        ),
      ).toMatchObject({ delivery: 'interrupted', channel: 'voice' });
      if (action !== 'hangup')
        await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
      await s
        .post('/turns', {
          submissionId: randomUUID(),
          content: 'Continue here.',
        })
        .expect(200);
      expect(
        textContext.some(
          (turn) => turn.content === 'An opening that was interrupted.',
        ),
      ).toBe(false);
    },
  );

  it('retains a played voice opening once without marking the call successful before the user participates', async () => {
    const s = await session();
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    await s.post('/calls/ready', { id }).expect(200);
    const c = connections.at(-1)!;
    await c.emit({
      type: 'response.created',
      response: {
        id: 'opening-response',
        status: 'in_progress',
        metadata: { generation: '0', purpose: 'opening' },
      },
    });
    for (let i = 0; i < 2; i++) {
      await c.emit({
        type: 'response.output_audio_transcript.done',
        item_id: 'opening-audio',
        response_id: 'opening-response',
        transcript: 'What should I call you?',
      });
      await c.emit({
        type: 'output_audio_buffer.stopped',
        response_id: 'opening-response',
      });
    }
    const saved = await s.read();
    expect(
      saved.body.turns.filter(
        (turn: { channel: string }) => turn.channel === 'voice',
      ),
    ).toMatchObject([
      { content: 'What should I call you?', delivery: 'played' },
    ]);
    expect(saved.body.onboarding.call).toBe('not_started');
    expect(saved.body.onboarding.policy.goals.userName.introduced).toBe(true);
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
  });

  it('commits an explicit spoken exit and switches the live call to main instructions', async () => {
    const s = await session();
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    await c.emit({
      type: 'input_audio_buffer.speech_started',
      item_id: 'exit-source',
    });
    await c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'exit-source',
      transcript: 'Skip setup. I do not need help yet.',
    });
    const before = (await s.read()).body;
    await c.emit({
      type: 'response.created',
      response: {
        id: 'exit-response',
        status: 'in_progress',
        metadata: { generation: '1', sourceItem: 'exit-source' },
      },
    });
    await c.emit({
      type: 'response.function_call_arguments.done',
      response_id: 'exit-response',
      call_id: 'exit-tool',
      name: 'capture_onboarding',
      arguments: JSON.stringify({
        expectedRevision: before.revision,
        askOnboarding: false,
        exitEvidence: 'Skip setup',
        changes: [],
        preferences: [],
        memory: [],
      }),
    });
    await vi.waitFor(async () =>
      expect((await s.read()).body.onboarding.mode).toBe('helping'),
    );
    expect((await s.read()).body.onboarding.facts.helpRequest.value).toBeNull();
    expect(c.closed).toBe(false);
    expect(
      c.sent.some(
        (event) =>
          event.type === 'session.update' &&
          (event.session as { instructions: string }).instructions.includes(
            'continuing the same conversation after onboarding',
          ),
      ),
    ).toBe(true);
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    expect((await s.read()).body.onboarding.mode).toBe('helping');
  });

  it('continues a known task when opening a call rather than asking for missing names', async () => {
    const s = await session();
    model.reply = async (_turns, tools) => {
      await tools.capture({
        expectedRevision: tools.state.revision,
        askOnboarding: false,
        exitEvidence: 'Skip setup',
        changes: [
          {
            goal: 'helpRequest',
            action: 'set',
            value: 'Prepare for an interview',
            evidence: 'Prepare for an interview',
          },
        ],
        preferences: [],
      });
      return 'Let us prepare.';
    };
    await s
      .post('/turns', {
        submissionId: randomUUID(),
        content: 'Skip setup. Prepare for an interview',
      })
      .expect(200);
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    await s.post('/calls/ready', { id }).expect(200);
    const response = connections
      .at(-1)!
      .sent.find((event) => event.type === 'response.create');
    expect(response).toMatchObject({
      response: {
        instructions: expect.stringContaining('Continue the saved first task'),
      },
    });
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
  });

  it('saves asynchronous final transcripts once, acknowledges a server tool and preserves text after hangup', async () => {
    const s = await session();
    const id = randomUUID();
    const start = await s
      .post('/calls/start', { id, sdp: 'v=0\r\no=browser' })
      .expect(200);
    expect(start.body.call).toMatchObject({
      id,
      status: 'active',
      controlReady: true,
    });
    const c = connections.at(-1)!;
    void c.emit({
      type: 'conversation.item.created',
      item: { id: 'user-one', type: 'message', role: 'user' },
    });
    void c.emit({
      type: 'conversation.item.created',
      previous_item_id: 'user-one',
      item: { id: 'assistant-one', type: 'message', role: 'assistant' },
    });
    void c.emit({
      type: 'response.output_audio_transcript.done',
      item_id: 'assistant-one',
      response_id: 'response-one',
      transcript: 'Let us practice.',
    });
    void c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'user-one',
      transcript: 'Help me with my interview.',
    });
    void c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'user-one',
      transcript: 'Help me with my interview.',
    });
    void c.emit({
      type: 'response.function_call_arguments.done',
      name: 'saved_context',
      call_id: 'tool-one',
      arguments: '{}',
    });
    await vi.waitFor(
      async () => {
        const saved = await s.read();
        expect(saved.body.turns.map((t: { role: string }) => t.role)).toEqual([
          'assistant',
          'user',
          'assistant',
        ]);
        expect(c.sent.some((e) => e.type === 'conversation.item.create')).toBe(
          true,
        );
      },
      { timeout: 5000 },
    );
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    expect(c.closed).toBe(true);
    const restored = await s.read();
    expect(restored.body.turns[2].delivery).toBe('interrupted');
    expect((await s.status()).body.call).toMatchObject({
      status: 'ended',
      reason: 'user_hangup',
      controlReady: false,
      toolAcknowledged: true,
    });
    const text = await s
      .post('/turns', { submissionId: randomUUID(), content: 'Continue here.' })
      .expect(200);
    expect(text.body.turns).toHaveLength(5);
  });
  it('invalidates the previous call immediately on takeover and fences its late events', async () => {
    const s = await session();
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    await request(app.getHttpServer())
      .post('/control')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .set('Cookie', s.cookie)
      .send({ tabId: randomUUID(), takeover: true })
      .expect(200);
    void c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'late-user',
      transcript: 'This must not appear.',
    });
    expect((await s.status()).body.call.status).toBe('ended');
    await s
      .post('/turns', { submissionId: randomUUID(), content: 'Stale owner' })
      .expect(403);
    expect((await s.read()).body.turns).toHaveLength(1);
  });
  it('ends at the persisted ten-minute deadline with a one-minute warning', async () => {
    const s = await session();
    const id = randomUUID();
    const start = await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    expect(Date.parse(start.body.call.deadline) - now).toBe(600000);
    expect(Date.parse(start.body.call.warningAt) - now).toBe(540000);
    now += 600001;
    const ended = await s.status();
    expect(ended.body.call).toMatchObject({
      status: 'ended',
      reason: 'time_limit',
    });
    expect(connections.at(-1)!.closed).toBe(true);
  });
  it('records the deadline when browser hangup beats the status poll', async () => {
    const s = await session(),
      id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    for (let i = 0; i < 59; i++) {
      now += 10000;
      await s.heartbeat();
    }
    now += 10001;
    const ended = await s
      .post('/calls/end', { id, reason: 'user_hangup' })
      .expect(200);
    expect(ended.body.call).toMatchObject({
      status: 'ended',
      reason: 'time_limit',
      controlReady: false,
    });
    expect(connections.at(-1)!.closed).toBe(true);
  });
  it('cancels an attempt before setup arrives and keeps a later call active', async () => {
    const s = await session();
    const cancelled = randomUUID();
    await s
      .post('/calls/end', { id: cancelled, reason: 'connection_lost' })
      .expect(200);
    await s.post('/calls/start', { id: cancelled, sdp: 'v=0' }).expect(409);
    const current = randomUUID();
    await s.post('/calls/start', { id: current, sdp: 'v=0' }).expect(200);
    await s
      .post('/calls/end', { id: cancelled, reason: 'connection_lost' })
      .expect(200);
    await s
      .post('/calls/end', { id: randomUUID(), reason: 'connection_lost' })
      .expect(200);
    expect((await s.status()).body.call).toMatchObject({
      id: current,
      status: 'active',
    });
    await s
      .post('/calls/end', { id: current, reason: 'user_hangup' })
      .expect(200);
  });
  it('ends a silently stalled sideband before allowing more voice', async () => {
    const s = await session();
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    c.stalled = true;
    expect((await s.status()).body.call).toMatchObject({
      status: 'failed',
      reason: 'control_lost',
      controlReady: false,
    });
    expect(c.closed).toBe(true);
    await s
      .post('/turns', {
        submissionId: randomUUID(),
        content: 'Continue in text.',
      })
      .expect(200);
  });
  it('persists ordered preferences and delivers text replies without audio playback', async () => {
    const s = await session();
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    const preference = {
      id,
      revision: 2,
      microphoneEnabled: false,
      replyMode: 'text',
    };
    await s.post('/calls/preferences', preference).expect(200);
    const sent = c.sent.length;
    await s.post('/calls/preferences', preference).expect(200);
    expect(c.sent.length).toBe(sent);
    await s
      .post('/calls/preferences', {
        ...preference,
        revision: 1,
        microphoneEnabled: true,
        replyMode: 'audio',
      })
      .expect(200);
    expect((await s.status()).body.call).toMatchObject({
      microphoneEnabled: false,
      replyMode: 'text',
      preferenceRevision: 2,
    });
    await s
      .post('/calls/preferences', { ...preference, replyMode: 'audio' })
      .expect(409);
    await s
      .post('/calls/preferences', { ...preference, revision: -1 })
      .expect(400);
    const submissionId = randomUUID();
    await s
      .post('/calls/turns', {
        id,
        submissionId,
        content: 'Please answer quietly.',
      })
      .expect(200);
    const outgoing = c.sent.filter((e) => e.type === 'response.create').at(-1)!;
    const response = outgoing.response as {
      metadata: { generation: string; sourceItem: string };
      output_modalities: string[];
    };
    expect(response.output_modalities).toEqual(['text']);
    await c.emit({
      type: 'response.created',
      response: {
        id: 'quiet-answer',
        status: 'in_progress',
        metadata: response.metadata,
      },
    });
    await c.emit({
      type: 'response.done',
      response: {
        id: 'quiet-answer',
        status: 'completed',
        output: [
          {
            id: 'quiet-item',
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: 'Here is your quiet answer.' },
            ],
          },
        ],
      },
    });
    const saved = (await s.read()).body;
    expect(
      saved.turns.find(
        (t: { content: string }) => t.content === 'Here is your quiet answer.',
      ),
    ).toMatchObject({ delivery: 'text', channel: 'text', callId: id });
    expect(saved.operation).toMatchObject({
      status: 'completed',
      errorCode: null,
    });
    await s.post('/journey', { action: 'skip' }).expect(200);
    expect((await s.read()).body.journey.delivery).toBe('text');
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    await s
      .post('/turns', { submissionId: randomUUID(), content: 'Continue here.' })
      .expect(200);
    expect(
      textContext.some((t) => t.content === 'Here is your quiet answer.'),
    ).toBe(true);
  });

  it('switches a pending response to text and rejects late audio delivery', async () => {
    const s = await session();
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    await s
      .post('/calls/turns', {
        id,
        submissionId: randomUUID(),
        content: 'Explain this slowly.',
      })
      .expect(200);
    const previous = c.sent.filter((e) => e.type === 'response.create').at(-1)!
      .response as { metadata: { generation: string; sourceItem: string } };
    await c.emit({
      type: 'response.created',
      response: {
        id: 'before-mode',
        status: 'in_progress',
        metadata: previous.metadata,
      },
    });
    await s
      .post('/calls/preferences', {
        id,
        revision: 1,
        microphoneEnabled: false,
        replyMode: 'text',
      })
      .expect(200);
    await c.emit({
      type: 'response.output_audio_transcript.done',
      response_id: 'before-mode',
      item_id: 'old-mode-item',
      transcript: 'Old spoken response.',
    });
    await c.emit({
      type: 'output_audio_buffer.stopped',
      response_id: 'before-mode',
    });
    await c.emit({
      type: 'response.done',
      response: { id: 'before-mode', status: 'cancelled' },
    });
    const next = c.sent.filter((e) => e.type === 'response.create').at(-1)!
      .response as {
      metadata: { generation: string; sourceItem: string };
      output_modalities: string[];
    };
    expect(next.output_modalities).toEqual(['text']);
    expect(next.metadata.sourceItem).toBe(previous.metadata.sourceItem);
    expect(Number(next.metadata.generation)).toBeGreaterThan(
      Number(previous.metadata.generation),
    );
    expect(
      (await s.read()).body.turns.find(
        (t: { content: string }) => t.content === 'Old spoken response.',
      ).delivery,
    ).toBe('interrupted');
    expect((await s.status()).body.call.status).toBe('active');
    const stranger = await session();
    await stranger
      .post('/calls/preferences', {
        id,
        revision: 2,
        microphoneEnabled: true,
        replyMode: 'audio',
      })
      .expect(409);
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
  });

  it('discards partial and muted speech even when final transcripts arrive after unmute', async () => {
    const s = await session();
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    await c.emit({
      type: 'input_audio_buffer.speech_started',
      item_id: 'partial-before-mute',
    });
    await s
      .post('/calls/preferences', {
        id,
        revision: 1,
        microphoneEnabled: false,
        replyMode: 'audio',
      })
      .expect(200);
    await c.emit({
      type: 'input_audio_buffer.speech_started',
      item_id: 'muted-noise',
    });
    await s
      .post('/calls/preferences', {
        id,
        revision: 2,
        microphoneEnabled: true,
        replyMode: 'audio',
      })
      .expect(200);
    for (const item_id of ['partial-before-mute', 'muted-noise']) {
      await c.emit({ type: 'input_audio_buffer.committed', item_id });
      await c.emit({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id,
        transcript: 'Unwanted background speech',
      });
    }
    expect(
      (await s.read()).body.turns.some(
        (t: { content: string }) => t.content === 'Unwanted background speech',
      ),
    ).toBe(false);
    expect(c.sent.some((e) => e.type === 'input_audio_buffer.clear')).toBe(
      true,
    );
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
  });

  it('resumes an unanswered call message in text once after hangup', async () => {
    const s = await session();
    const id = randomUUID();
    const submissionId = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const body = {
      submissionId,
      content: 'Keep this request after I hang up.',
    };
    await s.post('/calls/turns', { id, ...body }).expect(200);
    expect((await s.read()).body.operation.errorCode).toBe(
      'CALL_REPLY_PENDING',
    );
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    expect((await s.read()).body.operation).toMatchObject({
      id: submissionId,
      status: 'failed',
      errorCode: 'CALL_REPLY_INTERRUPTED',
    });
    await s.post('/turns', body).expect(200);
    await s.post('/turns', body).expect(200);
    const turns = (await s.read()).body.turns.filter(
      (t: { submissionId: string }) => t.submissionId === submissionId,
    );
    expect(turns.map((t: { role: string }) => t.role).sort()).toEqual([
      'assistant',
      'user',
    ]);
  });

  it('typing during speech interrupts old output, deduplicates input and keeps the call open', async () => {
    const s = await session();
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    void c.emit({
      type: 'response.created',
      response: {
        id: 'old-response',
        status: 'in_progress',
        metadata: { generation: '0' },
      },
    });
    void c.emit({
      type: 'response.output_audio_transcript.done',
      item_id: 'old-output',
      response_id: 'old-response',
      transcript: 'An old long answer.',
    });
    await vi.waitFor(async () =>
      expect((await s.read()).body.turns).toHaveLength(2),
    );
    const body = {
      id,
      submissionId: randomUUID(),
      content: 'Actually, use the corrected example.',
    };
    await s.post('/calls/turns', body).expect(200);
    await s.post('/calls/turns', body).expect(200);
    const wireItem = c.sent.find(
      (e) => e.type === 'conversation.item.create',
    )?.item;
    if (
      !wireItem ||
      typeof wireItem !== 'object' ||
      !('id' in wireItem) ||
      typeof wireItem.id !== 'string'
    )
      throw new Error('No provider user item');
    expect(wireItem.id.length).toBeLessThanOrEqual(32);
    expect(c.sent.filter((e) => e.type === 'response.cancel')).toHaveLength(1);
    expect(
      c.sent.filter((e) => e.type === 'output_audio_buffer.clear'),
    ).toHaveLength(1);
    expect(c.closed).toBe(false);
    void c.emit({
      type: 'output_audio_buffer.stopped',
      response_id: 'old-response',
    });
    const saved = await s.read();
    expect(
      saved.body.turns.filter(
        (t: { content: string }) => t.content === body.content,
      ),
    ).toHaveLength(1);
    expect(saved.body.turns[1].delivery).toBe('interrupted');
    void c.emit({
      type: 'response.done',
      response: { id: 'old-response', status: 'cancelled' },
    });
    await vi.waitFor(() =>
      expect(c.sent.some((e) => e.type === 'response.create')).toBe(true),
    );
    expect((await s.status()).body.call.status).toBe('active');
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    await s
      .post('/turns', {
        submissionId: randomUUID(),
        content: 'Continue in text.',
      })
      .expect(200);
    expect(textContext.some((t) => t.content === 'An old long answer.')).toBe(
      false,
    );
    const next = randomUUID();
    await s.post('/calls/start', { id: next, sdp: 'v=0' }).expect(200);
    expect(connections.at(-1)!.instructions).not.toContain(
      'An old long answer.',
    );
    await s.post('/calls/end', { id: next, reason: 'user_hangup' }).expect(200);
  });
  it('commits spoken facts from the finalized source and rejects a superseded voice tool', async () => {
    const s = await session(),
      id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    void c.emit({
      type: 'input_audio_buffer.speech_started',
      item_id: 'fact-source',
    });
    void c.emit({
      type: 'input_audio_buffer.committed',
      item_id: 'fact-source',
    });
    void c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'fact-source',
      transcript: 'Call me Sam. Help me prepare for an interview.',
    });
    await vi.waitFor(async () =>
      expect((await s.read()).body.turns).toHaveLength(2),
    );
    const before = await s.read();
    void c.emit({
      type: 'response.created',
      response: {
        id: 'facts-response',
        status: 'in_progress',
        metadata: { generation: '1', sourceItem: 'fact-source' },
      },
    });
    void c.emit({
      type: 'response.function_call_arguments.done',
      response_id: 'facts-response',
      call_id: 'facts-tool',
      name: 'capture_onboarding',
      arguments: JSON.stringify({
        expectedRevision: before.body.revision,
        askOnboarding: false,
        preferences: [],
        changes: [
          {
            goal: 'userName',
            action: 'set',
            value: 'Sam',
            evidence: 'Call me Sam',
          },
          {
            goal: 'helpRequest',
            action: 'set',
            value: 'prepare for an interview',
            evidence: 'Help me prepare for an interview',
          },
        ],
      }),
    });
    await vi.waitFor(async () =>
      expect((await s.read()).body.onboarding.facts.userName.value).toBe('Sam'),
    );
    expect((await s.read()).body.onboarding.graduated).toBe(true);
    await s
      .post('/calls/turns', {
        id,
        submissionId: randomUUID(),
        content: 'Focus on the introduction.',
      })
      .expect(200);
    void c.emit({
      type: 'response.function_call_arguments.done',
      response_id: 'facts-response',
      call_id: 'late-facts',
      name: 'capture_onboarding',
      arguments: JSON.stringify({
        expectedRevision: (await s.read()).body.revision,
        askOnboarding: false,
        preferences: [],
        changes: [
          {
            goal: 'userName',
            action: 'correct',
            value: 'Invented',
            evidence: 'Invented',
          },
        ],
      }),
    });
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    expect((await s.read()).body.onboarding.facts.userName.value).toBe('Sam');
  });
  it('saves facts split by speech detection with their own delayed transcripts and a later spoken correction', async () => {
    const s = await session(),
      id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    for (const item of ['split-name', 'split-task']) {
      void c.emit({ type: 'input_audio_buffer.committed', item_id: item });
      void c.emit({
        type: 'conversation.item.created',
        item: { id: item, type: 'message', role: 'user' },
      });
    }
    void c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'split-task',
      transcript:
        'Help me practice a back-end interview, around 400 words, and keep speaking.',
    });
    await vi.waitFor(async () =>
      expect((await s.read()).body.turns).toHaveLength(2),
    );
    const capture = (
      responseId: string,
      generation: number,
      sourceItem: string,
      expectedRevision: number,
      changes: object[],
    ) => {
      void c.emit({
        type: 'response.created',
        response: {
          id: responseId,
          status: 'in_progress',
          metadata: { generation: String(generation), sourceItem },
        },
      });
      void c.emit({
        type: 'response.function_call_arguments.done',
        response_id: responseId,
        call_id: responseId + '-tool',
        name: 'capture_onboarding',
        arguments: JSON.stringify({
          expectedRevision,
          askOnboarding: false,
          preferences: [],
          changes,
        }),
      });
    };
    capture('split-response', 2, 'split-task', 0, [
      {
        goal: 'userName',
        action: 'set',
        value: 'Taylor',
        evidence: 'My name is Taylor.',
      },
      {
        goal: 'helpRequest',
        action: 'set',
        value: 'practice a back-end interview, around 400 words.',
        evidence: 'Help me practice a back-end interview, around 400 words.',
      },
    ]);
    await vi.waitFor(async () =>
      expect((await s.status()).body.call.generation).toBe(2),
    );
    expect((await s.read()).body.onboarding.facts.userName.value).toBeNull();
    void c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'split-name',
      transcript: 'My name is Taylor.',
    });
    await vi.waitFor(async () =>
      expect((await s.read()).body.onboarding.facts.userName.value).toBe(
        'Taylor',
      ),
    );
    const saved = (await s.read()).body;
    expect(saved.onboarding.facts.helpRequest.value).toBe(
      'practice a back-end interview, around 400 words',
    );
    expect(saved.onboarding.facts.userName.sourceTurnId).toBe(
      saved.turns[1].id,
    );
    expect(saved.onboarding.facts.helpRequest.sourceTurnId).toBe(
      saved.turns[2].id,
    );
    void c.emit({
      type: 'response.done',
      response: { id: 'split-response', status: 'completed' },
    });
    void c.emit({
      type: 'input_audio_buffer.committed',
      item_id: 'correct-name',
    });
    void c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'correct-name',
      transcript:
        'Stop there, actually, call me Jordan. Keep the next answer to one sentence.',
    });
    await vi.waitFor(async () =>
      expect((await s.read()).body.turns).toHaveLength(4),
    );
    capture('correction-response', 3, 'correct-name', saved.revision, [
      {
        goal: 'userName',
        action: 'correct',
        value: 'Jordan',
        evidence: 'Call me Jordan',
      },
    ]);
    await vi.waitFor(async () =>
      expect((await s.read()).body.onboarding.facts.userName.value).toBe(
        'Jordan',
      ),
    );
    expect((await s.read()).body.onboarding.graduated).toBe(true);
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    expect((await s.read()).body.onboarding.facts.userName.value).toBe(
      'Jordan',
    );
  });
  it.each(['ambiguity', 'refusal'])(
    'does not rebase old voice proposals over a newer %s',
    async (decision) => {
      model.reply = async (turns, tools) => {
        const initial = turns.at(-1)!.content === 'Call me Taylor.';
        await tools.capture({
          expectedRevision: tools.state.revision,
          askOnboarding: false,
          changes: initial
            ? [
                {
                  goal: 'userName',
                  action: 'set',
                  value: 'Taylor',
                  evidence: 'Call me Taylor',
                },
              ]
            : decision === 'ambiguity'
              ? [
                  {
                    goal: 'userName',
                    action: 'clarify',
                    value: null,
                    evidence: 'Maybe Sam, maybe Jordan',
                  },
                ]
              : [],
          preferences:
            !initial && decision === 'refusal'
              ? [
                  {
                    goal: 'userName',
                    outcome: 'declined',
                    evidence: 'Leave my name alone',
                  },
                ]
              : [],
        });
        return 'We can keep working here.';
      };
      const s = await session(),
        id = randomUUID();
      const first = await s
        .post('/turns', {
          submissionId: randomUUID(),
          content: 'Call me Taylor.',
        })
        .expect(200);
      await s
        .post('/turns', {
          submissionId: randomUUID(),
          content:
            decision === 'ambiguity'
              ? 'Maybe Sam, maybe Jordan'
              : 'Leave my name alone',
        })
        .expect(200);
      await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
      const c = connections.at(-1)!;
      void c.emit({
        type: 'input_audio_buffer.committed',
        item_id: 'new-source',
      });
      void c.emit({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'new-source',
        transcript: 'Call me Jordan.',
      });
      void c.emit({
        type: 'response.created',
        response: {
          id: 'outdated',
          status: 'in_progress',
          metadata: { generation: '1', sourceItem: 'new-source' },
        },
      });
      void c.emit({
        type: 'response.function_call_arguments.done',
        response_id: 'outdated',
        call_id: 'outdated-tool',
        name: 'capture_onboarding',
        arguments: JSON.stringify({
          expectedRevision: first.body.revision,
          askOnboarding: false,
          preferences: [],
          changes: [
            {
              goal: 'userName',
              action: 'correct',
              value: 'Jordan',
              evidence: 'Call me Jordan',
            },
          ],
        }),
      });
      await vi.waitFor(() => {
        const result = c.sent.find(
          (e) =>
            e.type === 'conversation.item.create' &&
            (e.item as { call_id?: string })?.call_id === 'outdated-tool',
        );
        expect(result).toBeDefined();
        expect(
          JSON.parse((result!.item as { output: string }).output).code,
        ).toBe('stale');
      });
      const restored = (await s.read()).body.onboarding;
      expect(restored.facts.userName.value).toBe('Taylor');
      if (decision === 'ambiguity')
        expect(restored.facts.userName.status).toBe('ambiguous');
      else expect(restored.policy.goals.userName.outcome).toBe('declined');
      await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    },
  );
  it.each(['empty', 'failed'])(
    'saves a clear name after an %s transcription',
    async (outcome) => {
      const s = await session(),
        id = randomUUID();
      await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
      const c = connections.at(-1)!;
      void c.emit({ type: 'input_audio_buffer.committed', item_id: 'noise' });
      void c.emit({
        type:
          outcome === 'empty'
            ? 'conversation.item.input_audio_transcription.completed'
            : 'conversation.item.input_audio_transcription.failed',
        item_id: 'noise',
        transcript: '',
      });
      void c.emit({
        type: 'input_audio_buffer.committed',
        item_id: 'clear-name',
      });
      void c.emit({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'clear-name',
        transcript: 'Call me Sam.',
      });
      void c.emit({
        type: 'response.created',
        response: {
          id: 'after-noise',
          status: 'in_progress',
          metadata: { generation: '2', sourceItem: 'clear-name' },
        },
      });
      void c.emit({
        type: 'response.function_call_arguments.done',
        response_id: 'after-noise',
        call_id: 'after-noise-tool',
        name: 'capture_onboarding',
        arguments: JSON.stringify({
          expectedRevision: 0,
          askOnboarding: false,
          preferences: [],
          changes: [
            {
              goal: 'userName',
              action: 'set',
              value: 'Sam',
              evidence: 'Call me Sam',
            },
          ],
        }),
      });
      await vi.waitFor(async () =>
        expect((await s.read()).body.onboarding.facts.userName.value).toBe(
          'Sam',
        ),
      );
      expect((await s.read()).body.turns).toHaveLength(2);
      await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    },
  );
  it('keeps a refusal and task when speech detection splits them', async () => {
    const s = await session(),
      id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    for (const [item, transcript] of [
      ['refusal', 'Do not connect Gmail.'],
      ['task', 'Help me prepare for an interview.'],
    ]) {
      void c.emit({ type: 'input_audio_buffer.committed', item_id: item });
      void c.emit({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: item,
        transcript,
      });
    }
    await vi.waitFor(async () =>
      expect((await s.read()).body.turns).toHaveLength(3),
    );
    const before = (await s.read()).body;
    void c.emit({
      type: 'response.created',
      response: {
        id: 'refusal-response',
        status: 'in_progress',
        metadata: { generation: '2', sourceItem: 'task' },
      },
    });
    void c.emit({
      type: 'response.function_call_arguments.done',
      response_id: 'refusal-response',
      call_id: 'refusal-tool',
      name: 'capture_onboarding',
      arguments: JSON.stringify({
        expectedRevision: before.revision,
        askOnboarding: false,
        preferences: [
          {
            goal: 'gmail',
            outcome: 'declined',
            evidence: 'Do not connect Gmail',
          },
        ],
        changes: [
          {
            goal: 'helpRequest',
            action: 'set',
            value: 'prepare for an interview',
            evidence: 'Help me prepare for an interview',
          },
        ],
      }),
    });
    await vi.waitFor(async () =>
      expect((await s.read()).body.onboarding.policy.goals.gmail.outcome).toBe(
        'declined',
      ),
    );
    expect(
      (await s.read()).body.onboarding.facts.helpRequest.sourceTurnId,
    ).toBe(before.turns[2].id);
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    expect((await s.read()).body.onboarding.graduated).toBe(false);
  });
  it.each([
    { order: 'fact-first', outcome: 'declined', sourceIndex: 0 },
    { order: 'refusal-first', outcome: 'open', sourceIndex: 1 },
    { order: 'repeated-fact', outcome: 'open', sourceIndex: 2 },
  ])(
    'resolves a split name and refusal in spoken order: $order',
    async ({ order, outcome, sourceIndex }) => {
      const s = await session(),
        id = randomUUID();
      await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
      const c = connections.at(-1)!;
      const inputs = [
        ['name', 'Call me Sam.'],
        ['refusal', 'Do not ask my name again.'],
      ];
      if (order === 'refusal-first') inputs.reverse();
      if (order === 'repeated-fact')
        inputs.push(['repeat', 'Actually, call me Sam.']);
      for (const [item, transcript] of inputs) {
        void c.emit({ type: 'input_audio_buffer.committed', item_id: item });
        void c.emit({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: item,
          transcript,
        });
      }
      await vi.waitFor(async () =>
        expect((await s.read()).body.turns).toHaveLength(inputs.length + 1),
      );
      const before = (await s.read()).body;
      void c.emit({
        type: 'response.created',
        response: {
          id: 'ordered-response',
          status: 'in_progress',
          metadata: {
            generation: String(inputs.length),
            sourceItem: inputs.at(-1)![0],
          },
        },
      });
      void c.emit({
        type: 'response.function_call_arguments.done',
        response_id: 'ordered-response',
        call_id: 'ordered-tool',
        name: 'capture_onboarding',
        arguments: JSON.stringify({
          expectedRevision: before.revision,
          askOnboarding: false,
          preferences: [
            {
              goal: 'userName',
              outcome: 'declined',
              evidence: 'Do not ask my name again',
            },
          ],
          changes: [
            {
              goal: 'userName',
              action: 'set',
              value: 'Sam',
              evidence: 'Call me Sam',
            },
          ],
        }),
      });
      await vi.waitFor(async () =>
        expect((await s.read()).body.onboarding.facts.userName.value).toBe(
          'Sam',
        ),
      );
      expect(
        (await s.read()).body.onboarding.policy.goals.userName.outcome,
      ).toBe(outcome);
      expect((await s.read()).body.onboarding.facts.userName.sourceTurnId).toBe(
        before.turns[sourceIndex + 1].id,
      );
      await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    },
  );
  it.each(['ready', 'delayed'])(
    'holds continuations and parallel captures when transcription is %s',
    async (transcription) => {
      const s = await session(),
        id = randomUUID();
      await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
      const c = connections.at(-1)!;
      let complete!: () => void;
      const ready = new Promise<void>((resolve) => {
        complete = resolve;
      });
      repair.interpret = async ({ state, sources }) => {
        expect(sources.map((source) => source.text)).toEqual([
          'Call me Sam.',
          'Help me prepare for an interview.',
        ]);
        await ready;
        return {
          expectedRevision: state.revision,
          askOnboarding: false,
          preferences: [],
          changes: [
            {
              goal: 'userName',
              action: 'set',
              value: 'Sam',
              evidence: 'Call me Sam',
            },
            {
              goal: 'helpRequest',
              action: 'set',
              value: 'prepare for an interview',
              evidence: 'Help me prepare for an interview',
            },
          ],
        };
      };
      const inputs = [
        ['repair-name', 'Call me Sam.'],
        ['repair-task', 'Help me prepare for an interview.'],
      ];
      for (const [item, transcript] of inputs) {
        void c.emit({ type: 'input_audio_buffer.committed', item_id: item });
        if (transcription === 'ready')
          void c.emit({
            type: 'conversation.item.input_audio_transcription.completed',
            item_id: item,
            transcript,
          });
      }
      void c.emit({
        type: 'response.created',
        response: {
          id: 'malformed-response',
          status: 'in_progress',
          metadata: { generation: '2', sourceItem: 'repair-task' },
        },
      });
      await c.emit({
        type: 'response.function_call_arguments.done',
        response_id: 'malformed-response',
        call_id: 'context-before-repair',
        name: 'saved_context',
        arguments: '{}',
      });
      await c.emit({
        type: 'response.function_call_arguments.done',
        response_id: 'malformed-response',
        call_id: 'malformed-tool',
        name: 'capture_onboarding',
        arguments: '{}',
      });
      const before = c.sent.filter(
        (event) => event.type === 'response.create',
      ).length;
      await c.emit({
        type: 'response.done',
        response: { id: 'malformed-response', status: 'completed' },
      });
      expect(
        c.sent.filter((event) => event.type === 'response.create'),
      ).toHaveLength(before);
      if (transcription === 'delayed')
        for (const [item, transcript] of inputs)
          await c.emit({
            type: 'conversation.item.input_audio_transcription.completed',
            item_id: item,
            transcript,
          });
      await c.emit({
        type: 'response.function_call_arguments.done',
        response_id: 'malformed-response',
        call_id: 'parallel-empty-capture',
        name: 'capture_onboarding',
        arguments: JSON.stringify({
          expectedRevision: 2,
          askOnboarding: false,
          changes: [],
          preferences: [],
        }),
      });
      expect(
        c.sent.some(
          (event) =>
            (event.item as { call_id?: string })?.call_id ===
            'parallel-empty-capture',
        ),
      ).toBe(false);
      complete();
      await vi.waitFor(async () =>
        expect((await s.read()).body.onboarding.facts.userName.value).toBe(
          'Sam',
        ),
      );
      const saved = (await s.read()).body;
      expect(saved.onboarding.graduated).toBe(true);
      expect(saved.onboarding.facts.userName.sourceTurnId).toBe(
        saved.turns[1].id,
      );
      expect(saved.onboarding.facts.helpRequest.sourceTurnId).toBe(
        saved.turns[2].id,
      );
      await vi.waitFor(() =>
        expect(
          c.sent.some(
            (event) =>
              (event.item as { call_id?: string })?.call_id ===
              'parallel-empty-capture',
          ),
        ).toBe(true),
      );
      expect(
        c.sent.filter((event) => event.type === 'response.create'),
      ).toHaveLength(before + 1);
      await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    },
  );
  it.each(['typing', 'speech', 'hangup', 'takeover', 'reset', 'deadline'])(
    'keeps %s responsive and rejects a late interpretation',
    async (action) => {
      const s = await session(),
        id = randomUUID();
      await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
      const c = connections.at(-1)!;
      let complete!: (command: unknown) => void;
      let started = 0;
      const interpretation = new Promise<unknown>((resolve) => {
        complete = resolve;
      });
      repair.interpret = () => {
        started++;
        return interpretation;
      };
      void c.emit({
        type: 'input_audio_buffer.committed',
        item_id: 'slow-source',
      });
      void c.emit({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'slow-source',
        transcript: 'Call me Sam.',
      });
      void c.emit({
        type: 'response.created',
        response: {
          id: 'slow-response',
          status: 'in_progress',
          metadata: { generation: '1', sourceItem: 'slow-source' },
        },
      });
      const toolEvent = {
        type: 'response.function_call_arguments.done',
        response_id: 'slow-response',
        call_id: 'slow-tool',
        name: 'capture_onboarding',
        arguments: '{}',
      };
      void c.emit(toolEvent);
      void c.emit(toolEvent);
      await vi.waitFor(() => expect(started).toBe(1));
      let cookie = s.cookie;
      if (action === 'typing')
        await s
          .post('/calls/turns', {
            id,
            submissionId: randomUUID(),
            content: 'Actually, call me Jordan.',
          })
          .expect(200);
      if (action === 'speech')
        await c.emit({
          type: 'input_audio_buffer.committed',
          item_id: 'new-speech',
        });
      if (action === 'typing' || action === 'speech') {
        await c.emit({
          type: 'response.done',
          response: { id: 'slow-response', status: 'cancelled' },
        });
        expect(c.sent).toContainEqual(
          expect.objectContaining({
            type: 'response.create',
            response: expect.objectContaining({
              metadata: expect.objectContaining({ generation: '2' }),
            }),
          }),
        );
      }
      if (action === 'hangup')
        await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
      if (action === 'takeover')
        await request(app.getHttpServer())
          .post('/control')
          .set('Origin', origin)
          .set('X-Persona-Client', 'web')
          .set('Cookie', cookie)
          .send({ tabId: randomUUID(), takeover: true })
          .expect(200);
      if (action === 'reset')
        cookie = (
          await s.post('/reset', { operationId: randomUUID() }).expect(200)
        ).headers['set-cookie'][0];
      if (action === 'deadline') {
        now += 600001;
        expect((await s.status()).body.call.reason).toBe('time_limit');
      }
      complete({
        expectedRevision: 1,
        askOnboarding: false,
        preferences: [],
        changes: [
          {
            goal: 'userName',
            action: 'set',
            value: 'Sam',
            evidence: 'Call me Sam',
          },
        ],
      });
      // retryCapture subscribed first; its continuation queues before this one.
      await interpretation;
      // Provider acknowledgment now waits behind the queued late result.
      await c.emit({ type: 'rate_limits.updated' });
      const saved = await request(app.getHttpServer())
        .get('/session')
        .set('Cookie', cookie)
        .expect(200);
      expect(saved.body.onboarding.facts.userName.value).toBeNull();
      expect(
        c.sent.some(
          (e) => (e.item as { call_id?: string })?.call_id === 'slow-tool',
        ),
      ).toBe(false);
      expect(started).toBe(1);
      if (action === 'typing' || action === 'speech')
        await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    },
  );
  it('repairs rejected voice facts before replying and bounds malformed retries', async () => {
    const s = await session(),
      id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    void c.emit({
      type: 'input_audio_buffer.committed',
      item_id: 'repair-source',
    });
    void c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'repair-source',
      transcript: 'Call me Sam.',
    });
    await vi.waitFor(async () =>
      expect((await s.read()).body.turns).toHaveLength(2),
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      const responseId = `repair-response-${attempt}`;
      void c.emit({
        type: 'response.created',
        response: {
          id: responseId,
          status: 'in_progress',
          metadata: { generation: '1', sourceItem: 'repair-source' },
        },
      });
      void c.emit({
        type: 'response.function_call_arguments.done',
        response_id: responseId,
        call_id: `repair-tool-${attempt}`,
        name: 'capture_onboarding',
        arguments: JSON.stringify({ expectedRevision: 0, changes: [] }),
      });
      await vi.waitFor(() =>
        expect(
          c.sent.some(
            (e) =>
              e.type === 'conversation.item.create' &&
              (e.item as { call_id?: string })?.call_id ===
                `repair-tool-${attempt}`,
          ),
        ).toBe(true),
      );
      void c.emit({
        type: 'response.done',
        response: { id: responseId, status: 'completed' },
      });
      await vi.waitFor(() => {
        const responses = c.sent.filter((e) => e.type === 'response.create');
        expect(responses).toHaveLength(attempt + 2);
        const response = responses.at(-1)!.response as {
          tool_choice?: string;
          instructions?: string;
        };
        expect(response.tool_choice).toBe(attempt < 2 ? 'required' : undefined);
        if (attempt < 2)
          expect(response.instructions).toContain('Call me Sam.');
      });
    }
    expect((await s.read()).body.onboarding.facts.userName.value).toBeNull();
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
  });
  it('keeps malformed internal repair output out of chat and resumes dialogue', async () => {
    const s = await session(),
      id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    void c.emit({
      type: 'response.created',
      response: {
        id: 'internal-repair',
        status: 'in_progress',
        metadata: { generation: '0', purpose: 'fact_repair' },
      },
    });
    void c.emit({
      type: 'response.output_audio_transcript.done',
      response_id: 'internal-repair',
      item_id: 'bad-repair-output',
      transcript: '{"expectedRevision":0}',
    });
    void c.emit({
      type: 'response.done',
      response: {
        id: 'internal-repair',
        status: 'completed',
        output: [
          {
            id: 'bad-repair-output',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: '{"expectedRevision":0}' }],
          },
        ],
      },
    });
    await vi.waitFor(() =>
      expect(c.sent.some((e) => e.type === 'response.create')).toBe(true),
    );
    expect((await s.read()).body.turns).toHaveLength(1);
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
  });
  it('carries text into a call, then the call and its recap back into text', async () => {
    const s = await session();
    await s
      .post('/turns', {
        submissionId: randomUUID(),
        content: 'Help me prepare for my Stripe interview.',
      })
      .expect(200);
    recap.write = async (input) => {
      recapInputs.push(input);
      return 'Here is a quick recap of our call:\n- We started your introduction.\nNext step: time a 60-second answer.';
    };
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    expect(c.instructions).toContain(
      '{"role":"user","content":"Help me prepare for my Stripe interview.","channel":"text"}',
    );
    await s.post('/calls/ready', { id }).expect(200);
    await speak(
      c,
      'Shall we practise your introduction?',
      'Yes, start with my introduction.',
    );
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    await vi.waitFor(async () =>
      expect((await s.read()).body.turns.at(-1)).toMatchObject({
        role: 'assistant',
        kind: 'recap',
        callId: null,
      }),
    );
    expect(recapInputs).toEqual([
      {
        agentName: null,
        userName: null,
        turns: [
          {
            role: 'assistant',
            content: 'Shall we practise your introduction?',
          },
          { role: 'user', content: 'Yes, start with my introduction.' },
        ],
      },
    ]);
    const saved = (await s.read()).body;
    expect(saved.calls).toMatchObject([
      { id, status: 'ended', endedAt: expect.any(String) },
    ]);
    await s
      .post('/turns', {
        submissionId: randomUUID(),
        content: 'What should I practise next?',
      })
      .expect(200);
    expect(
      textContext
        .slice(-5)
        .map(({ role, content, callId }) => ({ role, content, callId })),
    ).toEqual([
      { role: 'assistant', content: 'Ready to help in text.', callId: null },
      {
        role: 'assistant',
        content: 'Shall we practise your introduction?',
        callId: id,
      },
      { role: 'user', content: 'Yes, start with my introduction.', callId: id },
      {
        role: 'assistant',
        content: expect.stringContaining('quick recap of our call'),
        callId: null,
      },
      { role: 'user', content: 'What should I practise next?', callId: null },
    ]);
    expect(
      saved.turns.filter((t: { kind: string }) => t.kind === 'recap'),
    ).toHaveLength(1);
  });

  it('skips the recap when nothing was said or the user already moved on', async () => {
    const s = await session();
    let asked = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    recap.write = async () => {
      asked++;
      await gate;
      return 'A late recap.';
    };
    const silent = randomUUID();
    await s.post('/calls/start', { id: silent, sdp: 'v=0' }).expect(200);
    await s
      .post('/calls/end', { id: silent, reason: 'user_hangup' })
      .expect(200);
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    await s.post('/calls/ready', { id }).expect(200);
    await speak(
      connections.at(-1)!,
      'How can I help?',
      'Help me plan my week.',
    );
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    await vi.waitFor(() => expect(asked).toBe(1));
    await s
      .post('/turns', {
        submissionId: randomUUID(),
        content: 'Keep going here.',
      })
      .expect(200);
    release();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const turns = (await s.read()).body.turns;
    expect(turns.some((t: { kind: string }) => t.kind === 'recap')).toBe(false);
    expect(turns.at(-1)).toMatchObject({ content: 'Ready to help in text.' });
  });

  it('reports lost sideband control and leaves committed chat usable', async () => {
    const s = await session();
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    connections.at(-1)!.disconnect();
    await vi.waitFor(async () =>
      expect((await s.status()).body.call).toMatchObject({
        status: 'failed',
        reason: 'control_lost',
        controlReady: false,
      }),
    );
    expect(
      (
        await s
          .post('/turns', {
            submissionId: randomUUID(),
            content: 'Can we keep typing?',
          })
          .expect(200)
      ).body.turns,
    ).toHaveLength(3);
  });
});
