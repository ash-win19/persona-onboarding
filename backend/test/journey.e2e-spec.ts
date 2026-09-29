import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ChatModule } from '../src/chat/chat.module.js';
import { DATABASE, type Database } from '../src/chat/database.js';
import { MODEL } from '../src/chat/model.js';
import { CHAT_CONFIG } from '../src/chat/config.js';
import { migrate } from '../src/chat/migration.js';
import { invitedAccount } from './invited-account.js';

describe('dashboard journey', () => {
  let app: INestApplication;
  let postgres: PGlite;
  let db: Database;
  const origin = 'https://persona.example';
  beforeAll(async () => {
    postgres = new PGlite();
    db = {
      query: (s, v) => postgres.query(s, v),
      transaction: (work) => postgres.transaction((tx) => work(tx)),
    };
    await migrate(db);
    const module = await Test.createTestingModule({ imports: [ChatModule] })
      .overrideProvider(DATABASE)
      .useValue(db)
      .overrideProvider(MODEL)
      .useValue({ reply: async () => 'Hello.' })
      .overrideProvider(CHAT_CONFIG)
      .useValue({ origins: [origin], secureCookies: true })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    await postgres.close();
  });
  async function session() {
    const credentials = await invitedAccount(app);
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(credentials)
      .expect(200);
    const cookie = response.headers['set-cookie'][0].split(';')[0];
    return { cookie, id: response.body.conversationId as string };
  }
  const change = (cookie: string, action: string) =>
    request(app.getHttpServer())
      .post('/journey')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send({ action });
  const read = (cookie: string) =>
    request(app.getHttpServer()).get('/session').set('Cookie', cookie);
  async function fact(id: string, goal: string, value: string) {
    const turn = randomUUID();
    await db.query(
      "INSERT INTO turns(id,conversation_id,submission_id,role,content) VALUES($1,$2,$3,'user',$4)",
      [turn, id, randomUUID(), value],
    );
    await db.query(
      "INSERT INTO onboarding_facts(id,conversation_id,goal,value,status,source_turn_id,revision,evidence) VALUES($1,$2,$3,$4,'known',$5,1,$4)",
      [randomUUID(), id, goal, value, turn],
    );
  }
  it('rejects normal entry before readiness and allows an explicit skip without inventing facts', async () => {
    const { cookie } = await session();
    await change(cookie, 'prepare').expect(409);
    await change(cookie, 'enter').expect(409);
    const skipped = await change(cookie, 'skip').expect(200);
    expect(skipped.body.journey).toMatchObject({
      ready: true,
      prepared: true,
      entered: false,
      delivery: 'text',
    });
    expect(skipped.body.onboarding.facts.helpRequest.value).toBeNull();
    const entered = await change(cookie, 'enter').expect(200);
    expect(entered.body.journey.entered).toBe(true);
    await change(cookie, 'enter').expect(200);
    const restored = await read(cookie).expect(200);
    expect(restored.body.journey.entered).toBe(true);
    expect(
      restored.body.turns.filter((t: { kind: string }) => t.kind === 'handoff'),
    ).toHaveLength(1);
  });
  it('requires a delivered offer, not a selected but failed or interrupted question', async () => {
    const { cookie, id } = await session();
    await fact(id, 'agentName', 'Nova');
    await fact(id, 'userName', 'Ash');
    await fact(id, 'helpRequest', 'Prepare for an interview');
    await db.query(
      "INSERT INTO onboarding_policy(conversation_id,goal,outcome,offered_visit) SELECT id,'voice','open',visit_id FROM conversations WHERE id=$1",
      [id],
    );
    expect((await read(cookie)).body.journey.ready).toBe(false);
    const turn = randomUUID();
    await db.query(
      "INSERT INTO turns(id,conversation_id,submission_id,role,content,delivery) VALUES($1,$2,$3,'assistant','Would you like to talk this through on a call?','interrupted')",
      [turn, id, randomUUID()],
    );
    expect((await read(cookie)).body.journey.ready).toBe(false);
    await db.query("UPDATE turns SET delivery='played' WHERE id=$1", [turn]);
    expect((await read(cookie)).body.journey.ready).toBe(true);
    await change(cookie, 'prepare').expect(200);
    await change(cookie, 'enter').expect(200);
  });
  it('accepts declined goals, and Gmail expiry cannot restart an entered dashboard', async () => {
    const { cookie, id } = await session();
    await fact(id, 'helpRequest', 'Prepare for an interview');
    for (const goal of ['agentName', 'userName', 'voice', 'gmail'])
      await db.query(
        "INSERT INTO onboarding_policy(conversation_id,goal,outcome) VALUES($1,$2,'declined') ON CONFLICT(conversation_id,goal) DO UPDATE SET outcome='declined'",
        [id, goal],
      );
    expect((await read(cookie)).body.journey.ready).toBe(true);
    await change(cookie, 'prepare').expect(200);
    await change(cookie, 'enter').expect(200);
    await db.query(
      'UPDATE conversations SET gmail_verified_at=NULL WHERE id=$1',
      [id],
    );
    const result = await read(cookie).expect(200);
    expect(result.body.onboarding.onboardingComplete).toBe(false);
    expect(result.body.journey.entered).toBe(true);
  });
  it('enforces origin, session and tab ownership, keeping accounts isolated', async () => {
    const { cookie } = await session();
    const other = await session();
    await change('', 'skip').expect(401);
    await request(app.getHttpServer())
      .post('/journey')
      .set('Cookie', cookie)
      .send({ action: 'skip' })
      .expect(403);
    const tabId = randomUUID();
    const claim = await request(app.getHttpServer())
      .post('/control')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send({ tabId, takeover: false })
      .expect(200);
    await change(cookie, 'skip').expect(403);
    await change(cookie, 'skip')
      .set('X-Persona-Tab', tabId)
      .set('X-Persona-Epoch', String(claim.body.control.epoch))
      .expect(200);
    expect((await read(other.cookie)).body.journey.prepared).toBe(false);
  });
});
