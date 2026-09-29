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
  const model: ReplyModel = { reply: async () => 'Ready to help in text.' };
  const connections: {
    emit: (event: VoiceEvent) => void;
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
      transaction: (work) => postgres.transaction(work),
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
    model.reply = async (turns) => {
      textContext = turns;
      return 'Ready to help in text.';
    };
  });
  async function session() {
    const created = await request(app.getHttpServer())
      .post('/session')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send({})
      .expect(201);
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
    c.emit({
      type: 'conversation.item.created',
      item: { id: 'user-one', type: 'message', role: 'user' },
    });
    c.emit({
      type: 'conversation.item.created',
      previous_item_id: 'user-one',
      item: { id: 'assistant-one', type: 'message', role: 'assistant' },
    });
    c.emit({
      type: 'response.output_audio_transcript.done',
      item_id: 'assistant-one',
      response_id: 'response-one',
      transcript: 'Let us practice.',
    });
    c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'user-one',
      transcript: 'Help me with my interview.',
    });
    c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'user-one',
      transcript: 'Help me with my interview.',
    });
    c.emit({
      type: 'response.function_call_arguments.done',
      name: 'saved_context',
      call_id: 'tool-one',
      arguments: '{}',
    });
    await vi.waitFor(
      async () => {
        const saved = await s.read();
        expect(saved.body.turns.map((t: { role: string }) => t.role)).toEqual([
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
    expect(restored.body.turns[1].delivery).toBe('interrupted');
    expect((await s.status()).body.call).toMatchObject({
      status: 'ended',
      reason: 'user_hangup',
      controlReady: false,
      toolAcknowledged: true,
    });
    const text = await s
      .post('/turns', { submissionId: randomUUID(), content: 'Continue here.' })
      .expect(200);
    expect(text.body.turns).toHaveLength(4);
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
    c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'late-user',
      transcript: 'This must not appear.',
    });
    expect((await s.status()).body.call.status).toBe('ended');
    await s
      .post('/turns', { submissionId: randomUUID(), content: 'Stale owner' })
      .expect(403);
    expect((await s.read()).body.turns).toHaveLength(0);
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
  it('typing during speech interrupts old output, deduplicates input and keeps the call open', async () => {
    const s = await session();
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    c.emit({
      type: 'response.created',
      response: {
        id: 'old-response',
        status: 'in_progress',
        metadata: { generation: '0' },
      },
    });
    c.emit({
      type: 'response.output_audio_transcript.done',
      item_id: 'old-output',
      response_id: 'old-response',
      transcript: 'An old long answer.',
    });
    await vi.waitFor(async () =>
      expect((await s.read()).body.turns).toHaveLength(1),
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
    c.emit({
      type: 'output_audio_buffer.stopped',
      response_id: 'old-response',
    });
    const saved = await s.read();
    expect(
      saved.body.turns.filter(
        (t: { content: string }) => t.content === body.content,
      ),
    ).toHaveLength(1);
    expect(saved.body.turns[0].delivery).toBe('interrupted');
    c.emit({
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
    c.emit({
      type: 'input_audio_buffer.speech_started',
      item_id: 'fact-source',
    });
    c.emit({ type: 'input_audio_buffer.committed', item_id: 'fact-source' });
    c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'fact-source',
      transcript: 'Call me Sam. Help me prepare for an interview.',
    });
    await vi.waitFor(async () =>
      expect((await s.read()).body.turns).toHaveLength(1),
    );
    const before = await s.read();
    c.emit({
      type: 'response.created',
      response: {
        id: 'facts-response',
        status: 'in_progress',
        metadata: { generation: '1', sourceItem: 'fact-source' },
      },
    });
    c.emit({
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
    c.emit({
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
      c.emit({ type: 'input_audio_buffer.committed', item_id: item });
      c.emit({
        type: 'conversation.item.created',
        item: { id: item, type: 'message', role: 'user' },
      });
    }
    c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'split-task',
      transcript:
        'Help me practice a back-end interview, around 400 words, and keep speaking.',
    });
    await vi.waitFor(async () =>
      expect((await s.read()).body.turns).toHaveLength(1),
    );
    const capture = (
      responseId: string,
      generation: number,
      sourceItem: string,
      expectedRevision: number,
      changes: object[],
    ) => {
      c.emit({
        type: 'response.created',
        response: {
          id: responseId,
          status: 'in_progress',
          metadata: { generation: String(generation), sourceItem },
        },
      });
      c.emit({
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
    c.emit({
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
      saved.turns[0].id,
    );
    expect(saved.onboarding.facts.helpRequest.sourceTurnId).toBe(
      saved.turns[1].id,
    );
    c.emit({
      type: 'response.done',
      response: { id: 'split-response', status: 'completed' },
    });
    c.emit({ type: 'input_audio_buffer.committed', item_id: 'correct-name' });
    c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'correct-name',
      transcript:
        'Stop there, actually, call me Jordan. Keep the next answer to one sentence.',
    });
    await vi.waitFor(async () =>
      expect((await s.read()).body.turns).toHaveLength(3),
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
      c.emit({ type: 'input_audio_buffer.committed', item_id: 'new-source' });
      c.emit({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'new-source',
        transcript: 'Call me Jordan.',
      });
      c.emit({
        type: 'response.created',
        response: {
          id: 'outdated',
          status: 'in_progress',
          metadata: { generation: '1', sourceItem: 'new-source' },
        },
      });
      c.emit({
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
      c.emit({ type: 'input_audio_buffer.committed', item_id: 'noise' });
      c.emit({
        type:
          outcome === 'empty'
            ? 'conversation.item.input_audio_transcription.completed'
            : 'conversation.item.input_audio_transcription.failed',
        item_id: 'noise',
        transcript: '',
      });
      c.emit({ type: 'input_audio_buffer.committed', item_id: 'clear-name' });
      c.emit({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'clear-name',
        transcript: 'Call me Sam.',
      });
      c.emit({
        type: 'response.created',
        response: {
          id: 'after-noise',
          status: 'in_progress',
          metadata: { generation: '2', sourceItem: 'clear-name' },
        },
      });
      c.emit({
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
      expect((await s.read()).body.turns).toHaveLength(1);
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
      c.emit({ type: 'input_audio_buffer.committed', item_id: item });
      c.emit({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: item,
        transcript,
      });
    }
    await vi.waitFor(async () =>
      expect((await s.read()).body.turns).toHaveLength(2),
    );
    const before = (await s.read()).body;
    c.emit({
      type: 'response.created',
      response: {
        id: 'refusal-response',
        status: 'in_progress',
        metadata: { generation: '2', sourceItem: 'task' },
      },
    });
    c.emit({
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
    ).toBe(before.turns[1].id);
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    expect((await s.read()).body.onboarding.graduated).toBe(true);
  });
  it.each([false, true])(
    'resolves a split name and refusal in spoken order, refusal first: %s',
    async (refusalFirst) => {
      const s = await session(),
        id = randomUUID();
      await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
      const c = connections.at(-1)!;
      const inputs = [
        ['name', 'Call me Sam.'],
        ['refusal', 'Do not ask my name again.'],
      ];
      if (refusalFirst) inputs.reverse();
      for (const [item, transcript] of inputs) {
        c.emit({ type: 'input_audio_buffer.committed', item_id: item });
        c.emit({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: item,
          transcript,
        });
      }
      await vi.waitFor(async () =>
        expect((await s.read()).body.turns).toHaveLength(2),
      );
      const before = (await s.read()).body;
      c.emit({
        type: 'response.created',
        response: {
          id: 'ordered-response',
          status: 'in_progress',
          metadata: { generation: '2', sourceItem: inputs[1][0] },
        },
      });
      c.emit({
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
      ).toBe(refusalFirst ? 'open' : 'declined');
      await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
    },
  );
  it('repairs rejected voice facts before replying and bounds malformed retries', async () => {
    const s = await session(),
      id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    c.emit({ type: 'input_audio_buffer.committed', item_id: 'repair-source' });
    c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'repair-source',
      transcript: 'Call me Sam.',
    });
    await vi.waitFor(async () =>
      expect((await s.read()).body.turns).toHaveLength(1),
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      const responseId = `repair-response-${attempt}`;
      c.emit({
        type: 'response.created',
        response: {
          id: responseId,
          status: 'in_progress',
          metadata: { generation: '1', sourceItem: 'repair-source' },
        },
      });
      c.emit({
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
      c.emit({
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
    c.emit({
      type: 'response.created',
      response: {
        id: 'internal-repair',
        status: 'in_progress',
        metadata: { generation: '0', purpose: 'fact_repair' },
      },
    });
    c.emit({
      type: 'response.output_audio_transcript.done',
      response_id: 'internal-repair',
      item_id: 'bad-repair-output',
      transcript: '{"expectedRevision":0}',
    });
    c.emit({
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
    expect((await s.read()).body.turns).toHaveLength(0);
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
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
    ).toHaveLength(2);
  });
});
