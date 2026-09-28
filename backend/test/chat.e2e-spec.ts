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

describe('saved conversation API', () => {
  let app: INestApplication;
  let postgres: PGlite;
  let db: Database;
  const model: ReplyModel = {
    reply: async () => 'Let us practice your introduction.',
  };
  const origin = 'https://persona.example';

  beforeEach(async () => {
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

  it('saves a real exchange and restores it using only the browser credential', async () => {
    const session = await request(app.getHttpServer())
      .post('/session')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send({})
      .expect(201);
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
      'Help me prepare for an interview.',
      'Let us practice your introduction.',
    ]);
    await request(app.getHttpServer()).get('/session').expect(401);
  });

  it('replays a committed submission after a lost acknowledgement without generating another reply', async () => {
    const session = await request(app.getHttpServer())
      .post('/session')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send({});
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
    ).toEqual(['user', 'assistant']);
    expect(replay.body.operation.status).toBe('completed');
  });

  it('keeps a failed reply retryable without duplicating the saved user message', async () => {
    const session = await request(app.getHttpServer())
      .post('/session')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send({});
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
    expect(failed.body.turns).toHaveLength(1);
    model.reply = async () => 'We can try again.';
    const retried = await send().expect(200);
    expect(
      retried.body.turns.map((t: { content: string }) => t.content),
    ).toEqual(['Prepare me.', 'We can try again.']);
  });

  it('serializes concurrent submissions and rejects conflicting reuse of an identifier', async () => {
    const session = await request(app.getHttpServer())
      .post('/session')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send({});
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
    expect(duplicate.body.turns).toHaveLength(1);
    await send({ ...payload, content: 'Different request.' }).expect(409);
    await send({
      submissionId: randomUUID(),
      content: 'A second request.',
    }).expect(409);
    finish('One reply.');
    expect((await first).body.turns).toHaveLength(2);
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
    const create = () =>
      request(app.getHttpServer())
        .post('/session')
        .set('Origin', origin)
        .set('X-Persona-Client', 'web')
        .send({});
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
    expect(isolated.body.turns).toEqual([]);
    await request(app.getHttpServer())
      .get('/session')
      .set('Cookie', 'persona_session=invalid')
      .expect(401);
  });

  it('reports database outages without acknowledging a message as saved', async () => {
    const session = await request(app.getHttpServer())
      .post('/session')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send({});
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
    expect((await send().expect(200)).body.turns).toHaveLength(2);
  });
});
