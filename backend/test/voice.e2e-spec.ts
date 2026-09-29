import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ChatModule } from '../src/chat/chat.module.js';
import { DATABASE, type Database } from '../src/chat/database.js';
import { MODEL } from '../src/chat/model.js';
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
  const connections: {
    emit: (event: VoiceEvent) => void;
    disconnect: () => void;
    sent: Record<string, unknown>[];
    closed: boolean;
    stalled: boolean;
  }[] = [];
  const provider: VoiceProvider = {
    connect: async (_sdp, _instructions, onEvent, onClose) => {
      const c = {
        emit: onEvent,
        disconnect: onClose,
        sent: [] as Record<string, unknown>[],
        closed: false,
        stalled: false,
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
      .useValue({ reply: async () => 'Ready to help in text.' })
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
    return { cookie, post, read, status };
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
    expect((await s.status()).body.call.status).toBe('active');
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
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
