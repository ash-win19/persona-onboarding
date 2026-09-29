import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID, randomBytes } from 'node:crypto';
import { ChatModule } from '../src/chat/chat.module.js';
import { DATABASE, type Database } from '../src/chat/database.js';
import { MODEL } from '../src/chat/model.js';
import { CHAT_CONFIG } from '../src/chat/config.js';
import { migrate } from '../src/chat/migration.js';
import { createAccount, resetPassword } from '../src/chat/account-admin.js';
import { CLOCK, credentialHash } from '../src/chat/authority.js';
import { SESSION_AGE } from '../src/chat/accounts.js';

describe('invite-only authentication', () => {
  let app: INestApplication;
  let pg: PGlite;
  let db: Database;
  let now = Date.now();
  const origin = 'https://persona.example';
  beforeAll(async () => {
    pg = new PGlite();
    db = { query: pg.query.bind(pg), transaction: pg.transaction.bind(pg) };
    await migrate(db);
    await createAccount(db, 'tanay@example.test', 'unique-test-password');
    const module = await Test.createTestingModule({ imports: [ChatModule] })
      .overrideProvider(DATABASE)
      .useValue(db)
      .overrideProvider(MODEL)
      .useValue({ reply: async () => 'A saved reply.' })
      .overrideProvider(CLOCK)
      .useValue(() => now)
      .overrideProvider(CHAT_CONFIG)
      .useValue({ origins: [origin], secureCookies: true })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });
  const login = (email: string, password = 'unique-test-password') =>
    request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send({ email, password });

  it('rejects anonymous entry and never creates a conversation or starts AI work', async () => {
    await request(app.getHttpServer())
      .post('/session')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send({})
      .expect(401);
    await request(app.getHttpServer()).get('/session').expect(401);
    await request(app.getHttpServer())
      .post('/turns')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send({ submissionId: randomUUID(), content: 'Bypass sign-in' })
      .expect(401);
    await request(app.getHttpServer()).get('/calls/status').expect(401);
    await request(app.getHttpServer()).get('/gmail/status').expect(401);
  });

  it('signs in an invited account and restores its saved conversation on another device', async () => {
    const signIn = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .set('Origin', origin)
        .set('X-Persona-Client', 'web')
        .send({
          email: ' Tanay@Example.Test ',
          password: 'unique-test-password',
        });
    const first = await signIn().expect(200);
    const cookie = first.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    await request(app.getHttpServer())
      .post('/turns')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .set('Cookie', cookie)
      .send({
        submissionId: randomUUID(),
        content: 'Help me prepare for my demo.',
      })
      .expect(200);
    const second = await signIn().expect(200);
    expect(second.body.conversationId).toBe(first.body.conversationId);
    expect(second.body.turns).toHaveLength(2);
    await request(app.getHttpServer())
      .get('/session')
      .set('Cookie', cookie)
      .expect(200);
  });

  it('does not reveal whether an email exists and checks origin before login', async () => {
    const wrong = await login('tanay@example.test', 'wrong-password').expect(
      401,
    );
    const missing = await login('unknown@example.test').expect(401);
    expect(missing.body).toEqual(wrong.body);
    await login('tanay@example.test')
      .set('Origin', 'https://hostile.example')
      .expect(403);
  });

  it('keeps two accounts isolated even with a supplied conversation ID', async () => {
    await createAccount(db, 'zach@example.test', 'unique-test-password');
    const tanay = await login('tanay@example.test').expect(200);
    const zach = await login('zach@example.test').expect(200);
    const isolated = await request(app.getHttpServer())
      .get('/session')
      .set('Cookie', zach.headers['set-cookie'][0])
      .query({ conversationId: tanay.body.conversationId })
      .expect(200);
    expect(isolated.body.conversationId).not.toBe(tanay.body.conversationId);
    expect(isolated.body.turns).toEqual([]);
  });

  it('revokes a signed-out session while preserving history for the next sign-in', async () => {
    const before = await login('tanay@example.test').expect(200);
    const cookie = before.headers['set-cookie'][0];
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .set('Cookie', cookie)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .get('/session')
      .set('Cookie', cookie)
      .expect(401);
    const after = await login('tanay@example.test').expect(200);
    expect(after.body.conversationId).toBe(before.body.conversationId);
    expect(after.body.turns).toHaveLength(2);
  });

  it('rejects legacy anonymous cookies', async () => {
    const token = randomBytes(32).toString('base64url');
    await db.query(
      'INSERT INTO conversations(id,credential_hash) VALUES($1,$2)',
      [randomUUID(), credentialHash(token)],
    );
    await request(app.getHttpServer())
      .get('/session')
      .set('Cookie', `persona_session=${token}`)
      .expect(401);
  });

  it('revokes old sessions and passwords when the operator resets a password', async () => {
    const before = await login('zach@example.test').expect(200);
    await resetPassword(db, 'zach@example.test', 'replacement-password');
    await request(app.getHttpServer())
      .get('/session')
      .set('Cookie', before.headers['set-cookie'][0])
      .expect(401);
    await login('zach@example.test').expect(401);
    const after = await login(
      'zach@example.test',
      'replacement-password',
    ).expect(200);
    expect(after.body.conversationId).toBe(before.body.conversationId);
  });

  it('expires sessions and bounds repeated password attempts across requests', async () => {
    const before = await login(
      'zach@example.test',
      'replacement-password',
    ).expect(200);
    now += SESSION_AGE + 1;
    await request(app.getHttpServer())
      .get('/session')
      .set('Cookie', before.headers['set-cookie'][0])
      .expect(401);
    for (let i = 0; i < 10; i++)
      await login('unknown@example.test').expect(401);
    await login('unknown@example.test').expect(429);
    now += 15 * 60000 + 1;
    await login('unknown@example.test').expect(401);
  });
});
