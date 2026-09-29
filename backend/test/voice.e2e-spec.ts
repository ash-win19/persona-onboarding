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
  }[] = [];
  const provider: VoiceProvider = {
    connect: async (_sdp, _instructions, onEvent, onClose) => {
      const c = {
        emit: onEvent,
        disconnect: onClose,
        sent: [] as Record<string, unknown>[],
        closed: false,
      };
      connections.push(c);
      return {
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
    const post = (path: string, body: unknown) =>
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
  it('ends at the persisted deadline and does not let an old timer end a new call', async () => {
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
