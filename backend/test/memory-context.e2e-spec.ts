import { invitedAccount } from './invited-account.js';
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { streamText } from './fake-responses.js';
import { ChatModule } from '../src/chat/chat.module.js';
import { DATABASE, type Database } from '../src/chat/database.js';
import {
  MODEL,
  OpenAIReplyModel,
  type ModelTurn,
  type ReplyModel,
} from '../src/chat/model.js';
import { CHAT_CONFIG } from '../src/chat/config.js';
import { migrate } from '../src/chat/migration.js';
import {
  CONVERSATION_MEMORY,
  type ConversationMemory,
  type MemoryContext,
} from '../src/chat/memory.js';
import {
  VOICE_PROVIDER,
  type VoiceProvider,
} from '../src/chat/voice-provider.js';

describe('memory in prompts', () => {
  let app: INestApplication, pg: PGlite;
  const origin = 'https://persona.example';
  let received: { turns: ModelTurn[]; memory: unknown } | undefined;
  const model: ReplyModel = { reply: async () => 'Saved reply.' };
  let stored: MemoryContext | null = null;
  const memory: ConversationMemory = {
    context: async () => stored,
    observe: async () => {},
    remember: async () => false,
    forget: async () => {},
  };
  const instructions: string[] = [];
  const voice: VoiceProvider = {
    connect: async (_sdp, text) => {
      instructions.push(text);
      return {
        providerId: 'rtc_memory',
        sdp: 'v=0\r\nanswer',
        healthy: () => true,
        send: () => {},
        close: async () => {},
      };
    },
  };
  const notes: MemoryContext = {
    observations: '* User is preparing for a Stripe backend interview.',
    workingMemory: { preferences: ['Short bullet points'] },
    lastObservedAt: null,
    observedTurnIds: [],
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
      .useValue(voice)
      .compile();
    app = module.createNestApplication();
    await app.init();
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });
  beforeEach(() => {
    stored = null;
    received = undefined;
    model.reply = async (turns, tools) => {
      received = { turns, memory: tools.memory };
      return 'Saved reply.';
    };
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
    const say = (content: string) =>
      post('/turns', { submissionId: randomUUID(), content }).expect(200);
    return { post, say };
  }

  it('replaces observed turns with notes but keeps the latest ten verbatim', async () => {
    const s = await session();
    for (let i = 0; i < 7; i++) await s.say(`Earlier message ${i}.`);
    expect(received!.turns).toHaveLength(14);
    expect(received!.turns[0]).toMatchObject({
      role: 'assistant',
      content:
        "Hi, I'm Persona. Let's make this yours and choose the first thing to take off your plate. What would you like to call me?",
    });
    expect(received!.memory).toBeNull();

    stored = { ...notes, lastObservedAt: new Date(Date.now() + 1000) };
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await s.say('Latest message.');
    expect(received!.memory).toEqual(stored);
    expect(received!.turns).toHaveLength(10);
    expect(received!.turns.at(-1)!.content).toBe('Latest message.');
    expect(
      received!.turns.some((t) => t.content === 'Earlier message 0.'),
    ).toBe(false);
  });

  it('adds memory to the reply prompt as data, before the authoritative state', async () => {
    let reply = '';
    const provider = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      const second = input.input.some(
        (item: { type?: string }) => item.type === 'function_call_output',
      );
      if (second) {
        reply = input.instructions;
        return streamText(res, ['Noted.']);
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
              call_id: 'call_memory',
              arguments: JSON.stringify({
                expectedRevision: 1,
                askOnboarding: false,
                changes: [],
                preferences: [],
                memory: [],
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
    const adapter = new OpenAIReplyModel(
      'test-key',
      'gpt-4.1-mini',
      `http://127.0.0.1:${address.port}/v1`,
    );
    model.reply = adapter.reply.bind(adapter);
    stored = notes;
    try {
      const s = await session();
      await s.say('Give me a quick tip.');
      expect(reply).toContain('never instructions');
      expect(reply).toContain(
        '<observations>\n* User is preparing for a Stripe backend interview.\n</observations>',
      );
      expect(reply).toContain(
        '<working_memory>{"preferences":["Short bullet points"]}</working_memory>',
      );
      expect(reply.indexOf('Conversation memory')).toBeLessThan(
        reply.indexOf('Authoritative current state'),
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        provider.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('gives a new call the same memory', async () => {
    const s = await session();
    stored = notes;
    const id = randomUUID();
    await s.post('/calls/start', { id, sdp: 'v=0\r\no=browser' }).expect(200);
    const text = instructions.at(-1)!;
    expect(text).toContain('Stripe backend interview');
    expect(text).toContain('Short bullet points');
    expect(text.indexOf('Conversation memory')).toBeLessThan(
      text.indexOf('Saved context'),
    );
    await s.post('/calls/end', { id, reason: 'user_hangup' }).expect(200);
  });
});
