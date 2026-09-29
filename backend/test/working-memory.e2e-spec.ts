import { invitedAccount } from './invited-account.js';
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ChatModule } from '../src/chat/chat.module.js';
import { DATABASE, type Database } from '../src/chat/database.js';
import { MODEL, type ReplyModel } from '../src/chat/model.js';
import { CHAT_CONFIG } from '../src/chat/config.js';
import { migrate } from '../src/chat/migration.js';
import type { CaptureResult } from '../src/chat/onboarding.js';
import {
  CONVERSATION_MEMORY,
  type ConversationMemory,
  type MemoryNote,
} from '../src/chat/memory.js';
import {
  VOICE_PROVIDER,
  type VoiceEvent,
  type VoiceProvider,
} from '../src/chat/voice-provider.js';

describe('working memory through capture_onboarding', () => {
  let app: INestApplication, pg: PGlite;
  const origin = 'https://persona.example';
  const model: ReplyModel = { reply: async () => 'Saved reply.' };
  let remembered: [string, MemoryNote[]][] = [];
  const memory: ConversationMemory = {
    context: async () => null,
    observe: async () => undefined,
    remember: async (id, notes) => {
      remembered.push([id, notes]);
      return true;
    },
    forget: async () => undefined,
  };
  const connections: {
    emit: (event: VoiceEvent) => Promise<void>;
    sent: Record<string, unknown>[];
  }[] = [];
  const provider: VoiceProvider = {
    connect: async (_sdp, _instructions, onEvent) => {
      const c = { emit: onEvent, sent: [] as Record<string, unknown>[] };
      connections.push(c);
      return {
        healthy: () => true,
        providerId: 'rtc_memory' + connections.length,
        sdp: 'v=0\r\nanswer',
        send: (event) => {
          c.sent.push(event);
        },
        close: async () => undefined,
      };
    },
  };
  beforeAll(async () => {
    pg = new PGlite();
    const db: Database = {
      query: (s, v) => pg.query(s, v),
      transaction: (work) => pg.transaction(work),
    };
    await migrate(db);
    const module = await Test.createTestingModule({ imports: [ChatModule] })
      .overrideProvider(DATABASE)
      .useValue(db)
      .overrideProvider(MODEL)
      .useValue(model)
      .overrideProvider(CHAT_CONFIG)
      .useValue({ origins: [origin], secureCookies: true })
      .overrideProvider(CONVERSATION_MEMORY)
      .useValue(memory)
      .overrideProvider(VOICE_PROVIDER)
      .useValue(provider)
      .compile();
    app = module.createNestApplication();
    await app.init();
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });
  beforeEach(() => {
    remembered = [];
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
    return { id: login.body.conversationId as string, post, read };
  }

  it('remembers only memory quoted from the latest message without affecting facts', async () => {
    const s = await session();
    let result: CaptureResult | undefined;
    model.reply = async (_turns, tools) => {
      result = await tools.capture({
        expectedRevision: tools.state.revision,
        askOnboarding: false,
        preferences: [],
        changes: [
          {
            goal: 'helpRequest',
            action: 'set',
            value: 'prepare for a backend interview',
            evidence: 'Help me prepare for a backend interview',
          },
        ],
        memory: [
          {
            kind: 'taskDetails',
            value: 'Stripe',
            evidence: 'backend interview at Stripe',
          },
          { kind: 'deadlines', value: 'Friday', evidence: 'due Friday' },
          {
            kind: 'preferences',
            value: 'long essays',
            evidence: 'I prefer short bullet answers',
          },
          { kind: 'userName', value: 'Stripe', evidence: 'at Stripe' },
        ],
      });
      return 'Let us start.';
    };
    const reply = await s
      .post('/turns', {
        submissionId: randomUUID(),
        content:
          'Help me prepare for a backend interview at Stripe. I prefer short bullet answers.',
      })
      .expect(200);
    const note = { kind: 'taskDetails', value: 'Stripe' };
    expect(result).toMatchObject({
      ok: true,
      code: 'committed',
      remembered: [note],
    });
    expect(remembered).toEqual([[s.id, [note]]]);
    expect(reply.body.onboarding.facts.helpRequest.value).toBe(
      'prepare for a backend interview',
    );
  });

  it('commits captures with no or malformed memory and remembers nothing', async () => {
    const s = await session();
    const results: CaptureResult[] = [];
    let memoryField: unknown;
    model.reply = async (_turns, tools) => {
      results.push(
        await tools.capture({
          expectedRevision: tools.state.revision,
          askOnboarding: false,
          changes: [
            {
              goal: 'userName',
              action: 'set',
              value: 'Sam',
              evidence: 'Call me Sam',
            },
          ],
          ...(memoryField === undefined ? {} : { memory: memoryField }),
        }),
      );
      return 'Hi Sam.';
    };
    await s
      .post('/turns', { submissionId: randomUUID(), content: 'Call me Sam.' })
      .expect(200);
    memoryField = 'Stripe';
    const second = await s
      .post('/turns', {
        submissionId: randomUUID(),
        content: 'Call me Sam, please.',
      })
      .expect(200);
    expect(results.map((r) => [r.code, r.remembered])).toEqual([
      ['committed', undefined],
      ['committed', undefined],
    ]);
    expect(second.body.onboarding.facts.userName.value).toBe('Sam');
    expect(remembered).toEqual([]);
  });

  it('does not remember again when a failed reply is retried', async () => {
    const s = await session();
    const submissionId = randomUUID();
    const codes: string[] = [];
    model.reply = async (_turns, tools) => {
      const result = await tools.capture({
        expectedRevision: tools.state.revision,
        askOnboarding: false,
        preferences: [],
        changes: [],
        memory: [{ kind: 'deadlines', value: 'Friday', evidence: 'by Friday' }],
      });
      codes.push(result.code);
      if (codes.length === 1) throw new Error('Provider failed after commit');
      return 'Friday it is.';
    };
    const payload = { submissionId, content: 'I need this by Friday.' };
    const failed = await s.post('/turns', payload).expect(200);
    expect(failed.body.operation.status).toBe('failed');
    const retry = await s.post('/turns', payload).expect(200);
    expect(retry.body.operation.status).toBe('completed');
    expect(codes).toEqual(['committed', 'already_applied']);
    expect(remembered).toEqual([
      [s.id, [{ kind: 'deadlines', value: 'Friday' }]],
    ]);
  });

  it('refreshes the live voice session after a call capture is remembered', async () => {
    const s = await session();
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0' }).expect(200);
    const c = connections.at(-1)!;
    void c.emit({
      type: 'input_audio_buffer.speech_started',
      item_id: 'memory-source',
    });
    void c.emit({
      type: 'input_audio_buffer.committed',
      item_id: 'memory-source',
    });
    void c.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'memory-source',
      transcript: 'Help me prepare for an interview at Stripe on Friday.',
    });
    await vi.waitFor(async () =>
      expect((await s.read()).body.turns).toHaveLength(2),
    );
    const before = await s.read();
    void c.emit({
      type: 'response.created',
      response: {
        id: 'memory-response',
        status: 'in_progress',
        metadata: { generation: '1', sourceItem: 'memory-source' },
      },
    });
    void c.emit({
      type: 'response.function_call_arguments.done',
      response_id: 'memory-response',
      call_id: 'memory-tool',
      name: 'capture_onboarding',
      arguments: JSON.stringify({
        expectedRevision: before.body.revision,
        askOnboarding: false,
        preferences: [],
        changes: [
          {
            goal: 'helpRequest',
            action: 'set',
            value: 'prepare for an interview',
            evidence: 'Help me prepare for an interview',
          },
        ],
        memory: [
          {
            kind: 'deadlines',
            value: 'on Friday',
            evidence: 'at Stripe on Friday',
          },
        ],
      }),
    });
    await vi.waitFor(() =>
      expect(c.sent.some((e) => e.type === 'conversation.item.create')).toBe(
        true,
      ),
    );
    const note = { kind: 'deadlines', value: 'on Friday' };
    expect(remembered).toEqual([[s.id, [note]]]);
    const update = c.sent.findIndex((e) => e.type === 'session.update');
    const output = c.sent.findIndex(
      (e) => e.type === 'conversation.item.create',
    );
    expect(update).toBeGreaterThanOrEqual(0);
    expect(update).toBeLessThan(output);
    expect(
      JSON.parse(
        (c.sent[output].item as { output: string }).output,
      ) as CaptureResult,
    ).toMatchObject({ code: 'committed', remembered: [note] });
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
  });
});
