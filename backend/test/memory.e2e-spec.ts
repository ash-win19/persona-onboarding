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
import {
  CONVERSATION_MEMORY,
  type ConversationMemory,
} from '../src/chat/memory.js';

describe('conversation memory lifecycle', () => {
  let app: INestApplication, pg: PGlite;
  const origin = 'https://persona.example';
  const model: ReplyModel = { reply: async () => 'Saved reply.' };
  const calls: { observe: string[]; forget: string[] } = {
    observe: [],
    forget: [],
  };
  const memory: ConversationMemory = {
    context: async () => null,
    observe: async (id) => {
      calls.observe.push(id);
    },
    remember: async () => false,
    forget: async (id) => {
      calls.forget.push(id);
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
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });

  it('observes after each saved reply and forgets the conversation on reset', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(await invitedAccount(app))
      .expect(200);
    const cookie = login.headers['set-cookie'][0];
    const id = login.body.conversationId;
    const tabId = randomUUID();
    const claim = await request(app.getHttpServer())
      .post('/control')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .set('Cookie', cookie)
      .send({ tabId, takeover: false })
      .expect(200);
    const post = (path: string, body: object, useCookie = cookie) =>
      request(app.getHttpServer())
        .post(path)
        .set('Origin', origin)
        .set('X-Persona-Client', 'web')
        .set('Cookie', useCookie)
        .set('X-Persona-Tab', tabId)
        .set('X-Persona-Epoch', String(claim.body.control.epoch))
        .send(body);

    await post('/turns', {
      submissionId: randomUUID(),
      content: 'Help me prepare for an interview.',
    }).expect(200);
    expect(calls.observe).toEqual([id]);

    model.reply = () => Promise.reject(new Error('down'));
    await post('/turns', {
      submissionId: randomUUID(),
      content: 'Another message.',
    }).expect(200);
    expect(calls.observe).toEqual([id]);

    const reset = await post('/reset', { operationId: randomUUID() }).expect(
      200,
    );
    expect(reset.body.conversationId).not.toBe(id);
    expect(calls.forget).toEqual([id]);
  });
});
