import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ChatModule } from '../src/chat/chat.module.js';
import { DATABASE, type Database } from '../src/chat/database.js';
import { MODEL } from '../src/chat/model.js';
import { DAILY_MODEL } from '../src/chat/daily-model.js';
import { CHAT_CONFIG } from '../src/chat/config.js';
import { migrate } from '../src/chat/migration.js';
import { invitedAccount } from './invited-account.js';

describe('personal intelligence workspace', () => {
  let app: INestApplication;
  let postgres: PGlite;
  let db: Database;
  const origin = 'https://persona.example';
  const daily = vi.fn(async () => 'Start with the most time-sensitive task.');
  beforeAll(async () => {
    postgres = new PGlite();
    db = {
      query: (s, v) => postgres.query(s, v),
      transaction: (work) => postgres.transaction((tx) => work(tx)),
    };
    await migrate(db);
    await migrate(db);
    const module = await Test.createTestingModule({ imports: [ChatModule] })
      .overrideProvider(DATABASE)
      .useValue(db)
      .overrideProvider(MODEL)
      .useValue({ reply: async () => 'Hello.' })
      .overrideProvider(DAILY_MODEL)
      .useValue({ reply: daily })
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
  async function session(entered = true) {
    const credentials = await invitedAccount(app);
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(credentials)
      .expect(200);
    const cookie = response.headers['set-cookie'][0].split(';')[0];
    if (entered)
      await db.query(
        'UPDATE conversations SET dashboard_entered_at=now(),graduated_at=now() WHERE id=$1',
        [response.body.conversationId],
      );
    return { cookie, root: response.body.conversationId as string };
  }
  const post = (cookie: string, path: string, body: object) =>
    request(app.getHttpServer())
      .post(path)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(body);
  const get = (cookie: string, path = '/workspace') =>
    request(app.getHttpServer()).get(path).set('Cookie', cookie);
  const complete = (cookie: string, id: string, completed: boolean) =>
    request(app.getHttpServer())
      .patch(`/workspace/priorities/${id}`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send({ completed });

  it('saves priorities idempotently, completes and reopens them, and isolates accounts', async () => {
    const a = await session(),
      b = await session(),
      id = randomUUID();
    await post(a.cookie, '/workspace/priorities', {
      id,
      title: 'Prepare the proposal',
    }).expect(200);
    await post(a.cookie, '/workspace/priorities', {
      id,
      title: 'Prepare the proposal',
    }).expect(200);
    expect((await get(a.cookie)).body.priorities).toEqual([
      { id, title: 'Prepare the proposal', completed: false },
    ]);
    expect((await get(b.cookie)).body.priorities).toEqual([]);
    await complete(b.cookie, id, true).expect(404);
    await post(b.cookie, '/workspace/priorities', {
      id,
      title: 'Steal it',
    }).expect(409);
    expect(
      (await complete(a.cookie, id, true)).body.priorities[0].completed,
    ).toBe(true);
    expect(
      (await complete(a.cookie, id, false)).body.priorities[0].completed,
    ).toBe(false);
  });
  it('keeps daily messages apart from onboarding and other daily chats, carries profile, and restores history', async () => {
    const { cookie, root } = await session();
    const source = randomUUID();
    await db.query(
      "INSERT INTO turns(id,conversation_id,submission_id,role,content) VALUES($1,$2,$3,'user','I am Lea. Call yourself Nova. Help me prepare for an interview.')",
      [source, root, randomUUID()],
    );
    for (const [goal, value] of [
      ['userName', 'Lea'],
      ['agentName', 'Nova'],
      ['helpRequest', 'Prepare for an interview'],
    ])
      await db.query(
        "INSERT INTO onboarding_facts(id,conversation_id,goal,value,status,source_turn_id,revision,evidence) VALUES($1,$2,$3,$4,'known',$5,1,$4)",
        [randomUUID(), root, goal, value, source],
      );
    const before = (await get(cookie, '/session')).body.turns;
    const id = randomUUID(),
      other = randomUUID(),
      submissionId = randomUUID();
    daily.mockClear();
    const response = await post(cookie, `/workspace/threads/${id}`, {
      submissionId,
      content: 'Plan my day',
    }).expect(200);
    expect(response.body.entries[0]).toMatchObject({
      content: 'Plan my day',
      status: 'completed',
      reply: 'Start with the most time-sensitive task.',
    });
    expect(daily.mock.calls[0]).toEqual([
      [{ role: 'user', content: 'Plan my day' }],
      {
        userName: 'Lea',
        agentName: 'Nova',
        firstTask: 'Prepare for an interview',
        tasks: 'Prepare for an interview',
        starterPlan: null,
      },
    ]);
    await post(cookie, `/workspace/threads/${id}`, {
      submissionId,
      content: 'Plan my day',
    }).expect(200);
    expect(daily).toHaveBeenCalledTimes(1);
    await post(cookie, `/workspace/threads/${other}`, {
      submissionId: randomUUID(),
      content: 'Draft a thank-you',
    }).expect(200);
    expect(
      (await get(cookie, `/workspace/threads/${id}`)).body.entries,
    ).toHaveLength(1);
    expect((await get(cookie)).body.threads).toHaveLength(2);
    expect((await get(cookie, '/session')).body.turns).toEqual(before);
    expect((await get(cookie, '/session')).body.conversationId).toBe(root);
    const b = await session();
    await get(b.cookie, `/workspace/threads/${id}`).expect(404);
    await post(b.cookie, `/workspace/threads/${id}`, {
      submissionId: randomUUID(),
      content: 'Read secret',
    }).expect(404);
  });
  it('carries an accepted no-task plan without reviving an older task', async () => {
    const { cookie, root } = await session();
    const plan = ['Your Persona is ready whenever you want help.'];
    await db.query(
      'UPDATE conversations SET onboarding_intake=$2 WHERE id=$1',
      [
        root,
        JSON.stringify({
          tasks: [],
          noTasks: true,
          questionsAsked: 0,
          clarification: null,
          plan: {
            id: randomUUID(),
            steps: plan,
            presented: true,
            accepted: true,
          },
        }),
      ],
    );
    daily.mockClear();
    await post(cookie, `/workspace/threads/${randomUUID()}`, {
      submissionId: randomUUID(),
      content: 'Hello',
    }).expect(200);
    expect(daily.mock.calls[0]).toEqual([
      expect.any(Array),
      expect.objectContaining({
        firstTask: null,
        tasks: null,
        starterPlan: plan.join('\n'),
      }),
    ]);
  });
  it('retains failed messages for retry without duplicates and blocks further messages until resolved', async () => {
    const { cookie } = await session();
    const id = randomUUID(),
      submissionId = randomUUID();
    daily.mockRejectedValueOnce(new Error('provider unavailable'));
    const failed = await post(cookie, `/workspace/threads/${id}`, {
      submissionId,
      content: 'Help me decide',
    }).expect(200);
    expect(failed.body.entries[0].status).toBe('failed');
    await post(cookie, `/workspace/threads/${id}`, {
      submissionId: randomUUID(),
      content: 'Another message',
    }).expect(409);
    await post(cookie, `/workspace/threads/${id}`, {
      submissionId,
      content: 'Changed text',
    }).expect(409);
    const retry = await post(cookie, `/workspace/threads/${id}`, {
      submissionId,
      content: 'Help me decide',
    }).expect(200);
    expect(retry.body.entries).toHaveLength(1);
    expect(retry.body.entries[0].status).toBe('completed');
  });
  it('requires a valid session, entered dashboard, write origin, owner, and bounded content', async () => {
    const { cookie } = await session(),
      id = randomUUID();
    const unentered = await session(false);
    await get('').expect(401);
    await get(unentered.cookie).expect(403);
    await request(app.getHttpServer())
      .post('/workspace/priorities')
      .set('Cookie', cookie)
      .send({ id, title: 'x' })
      .expect(403);
    await post(cookie, '/workspace/priorities', {
      id,
      title: 'x'.repeat(501),
    }).expect(400);
    await post(cookie, '/workspace/threads/not-an-id', {
      submissionId: randomUUID(),
      content: 'x',
    }).expect(400);
    const tabId = randomUUID();
    const claim = await post(cookie, '/control', {
      tabId,
      takeover: false,
    }).expect(200);
    await post(cookie, '/workspace/priorities', { id, title: 'x' }).expect(403);
    await post(cookie, '/workspace/priorities', { id, title: 'x' })
      .set('X-Persona-Tab', tabId)
      .set('X-Persona-Epoch', String(claim.body.control.epoch))
      .expect(200);
  });
  it('fences model completion after takeover and removes workspace data on reset', async () => {
    const { cookie, root } = await session();
    let finish!: (value: string) => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    daily.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
          started();
        }),
    );
    const id = randomUUID(),
      submissionId = randomUUID();
    const pending = post(cookie, `/workspace/threads/${id}`, {
      submissionId,
      content: 'Private work',
    }).then((r) => r);
    await began;
    await post(cookie, '/control', {
      tabId: randomUUID(),
      takeover: true,
    }).expect(200);
    finish('A stale reply');
    expect((await pending).body.entries[0]).toMatchObject({
      reply: null,
      status: 'failed',
    });
    await db.query('DELETE FROM conversations WHERE id=$1', [root]);
    expect(
      (await db.query('SELECT id FROM daily_threads WHERE id=$1', [id])).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query('SELECT id FROM daily_entries WHERE id=$1', [
          submissionId,
        ])
      ).rows,
    ).toHaveLength(0);
  });
});
