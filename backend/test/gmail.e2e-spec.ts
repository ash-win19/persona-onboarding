import { invitedAccount } from './invited-account.js';
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import { ChatModule } from '../src/chat/chat.module.js';
import { DATABASE, type Database } from '../src/chat/database.js';
import { MODEL } from '../src/chat/model.js';
import { CHAT_CONFIG } from '../src/chat/config.js';
import { CLOCK } from '../src/chat/authority.js';
import { migrate } from '../src/chat/migration.js';
import { TOKEN_KEY } from '../src/chat/gmail.js';
import {
  GMAIL_PROVIDER,
  GMAIL_SCOPE,
  GmailAuthorizationError,
  GoogleGmailProvider,
  type GmailProvider,
} from '../src/chat/gmail-provider.js';

describe('Gmail consent lifecycle', () => {
  let app: INestApplication, pg: PGlite, db: Database;
  let now = Date.now(),
    exchanges = 0,
    revoked = false;
  let hold: Promise<void> | undefined;
  const origin = 'https://persona.example';
  const provider: GmailProvider = {
    available: () => true,
    authorize: (state, challenge) =>
      'https://accounts.google.com/test?' +
      new URLSearchParams({ state, challenge }),
    exchange: async (code) => {
      exchanges++;
      if (code === 'held') await hold;
      return {
        accessToken: 'access-' + code,
        refreshToken: 'refresh-' + code,
        expiresAt: now + 3600000,
        scope: code === 'wrong-scope' ? 'openid' : GMAIL_SCOPE,
      };
    },
    refresh: async () => {
      if (revoked) throw new GmailAuthorizationError();
      return {
        accessToken: 'fresh-access',
        expiresAt: now + 3600000,
        scope: GMAIL_SCOPE,
      };
    },
    profile: async (token) => {
      if (revoked) throw new GmailAuthorizationError();
      return token + '@example.test';
    },
  };
  beforeAll(async () => {
    pg = new PGlite();
    db = {
      query: (s, v) => pg.query(s, v),
      transaction: (work) => pg.transaction(work),
    };
    await migrate(db);
    const module = await Test.createTestingModule({ imports: [ChatModule] })
      .overrideProvider(DATABASE)
      .useValue(db)
      .overrideProvider(MODEL)
      .useValue({ reply: async () => 'We can keep chatting.' })
      .overrideProvider(CHAT_CONFIG)
      .useValue({ origins: [origin], secureCookies: true })
      .overrideProvider(CLOCK)
      .useValue(() => now)
      .overrideProvider(GMAIL_PROVIDER)
      .useValue(provider)
      .overrideProvider(TOKEN_KEY)
      .useValue(randomBytes(32).toString('base64'))
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });
  beforeEach(() => {
    now = Date.now();
    revoked = false;
    exchanges = 0;
    hold = undefined;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function session() {
    const created = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(await invitedAccount(app))
      .expect(200);
    const cookie = created.headers['set-cookie'][0],
      tabId = randomUUID();
    const claim = await request(app.getHttpServer())
      .post('/control')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .set('Cookie', cookie)
      .send({ tabId, takeover: false })
      .expect(200);
    const post = (path: string, body: object = {}) =>
      request(app.getHttpServer())
        .post(path)
        .set('Origin', origin)
        .set('X-Persona-Client', 'web')
        .set('Cookie', cookie)
        .set('X-Persona-Tab', tabId)
        .set('X-Persona-Epoch', String(claim.body.control.epoch))
        .send(body);
    const get = (path: string) =>
      request(app.getHttpServer()).get(path).set('Cookie', cookie);
    const start = async () => {
      const r = await post('/gmail/start').expect(200);
      return {
        id: r.body.attemptId,
        state: new URL(r.body.url).searchParams.get('state')!,
      };
    };
    const callback = (state: string, code?: string, error?: string) =>
      get(
        '/gmail/callback?' +
          new URLSearchParams({
            state,
            ...(code ? { code } : {}),
            ...(error ? { error } : {}),
          }),
      ).expect(303);
    return { post, get, start, callback, id: created.body.conversationId };
  }
  it('verifies profile access once, encrypts credentials, and keeps the same conversation', async () => {
    const s = await session();
    await s
      .post('/turns', {
        submissionId: randomUUID(),
        content: 'Keep my conversation.',
      })
      .expect(200);
    const a = await s.start();
    await s.callback(a.state, 'good');
    await s.callback(a.state, 'good');
    expect(exchanges).toBe(1);
    const status = await s.get('/gmail/status').expect(200);
    expect(status.body).toMatchObject({
      status: 'connected',
      email: 'access-good@example.test',
    });
    expect(JSON.stringify(status.body)).not.toContain('refresh-good');
    const stored = (
      await db.query<{ tokens: string }>(
        'SELECT tokens FROM gmail_connections WHERE conversation_id=$1',
        [s.id],
      )
    ).rows[0];
    expect(stored.tokens).not.toContain('refresh-good');
    expect(stored.tokens).not.toContain('access-good');
    const restored = await s.get('/session').expect(200);
    expect(restored.body.conversationId).toBe(s.id);
    expect(restored.body.turns).toHaveLength(4);
    expect(restored.body.onboarding.gmail).toBe('connected');
  });
  it('rejects mismatched, denied, closed, expired and insufficient-scope attempts', async () => {
    const s = await session(),
      other = await session();
    let a = await s.start();
    await other.callback(a.state, 'good');
    expect(exchanges).toBe(0);
    await s.callback(a.state, undefined, 'access_denied');
    expect((await s.get('/gmail/status')).body.attempt.status).toBe('denied');
    a = await s.start();
    await s.post('/gmail/cancel', { id: a.id }).expect(200);
    await s.callback(a.state, 'good');
    expect(exchanges).toBe(0);
    a = await s.start();
    now += 600001;
    await s.callback(a.state, 'good');
    expect((await s.get('/gmail/status')).body.attempt.status).toBe('expired');
    now = Date.now();
    a = await s.start();
    await s.callback(a.state, 'wrong-scope');
    expect((await s.get('/gmail/status')).body.status).toBe('not_connected');
  });
  it('prevents an old in-flight exchange from replacing a newer successful connection', async () => {
    const s = await session();
    let release!: () => void;
    hold = new Promise<void>((r) => {
      release = r;
    });
    const first = await s.start();
    const old = s.callback(first.state, 'held').then((r) => r);
    await vi.waitFor(() => expect(exchanges).toBe(1));
    const latest = await s.start();
    await s.callback(latest.state, 'new');
    release();
    await old;
    const status = await s.get('/gmail/status').expect(200);
    expect(status.body.email).toBe('access-new@example.test');
    expect((await s.get('/session')).body.turns).toHaveLength(2);
  });
  it.each([
    [403, 'rateLimitExceeded', false],
    [403, 'userRateLimitExceeded', false],
    [403, 'dailyLimitExceeded', false],
    [403, 'insufficientPermissions', true],
    [401, 'authError', true],
  ])(
    'classifies Google HTTP %s %s without deleting valid grants',
    async (status, reason, invalid) => {
      const s = await session();
      const a = await s.start();
      await s.callback(a.state, 'good');
      const tokens = async () =>
        (
          await db.query<{ tokens: string }>(
            'SELECT tokens FROM gmail_connections WHERE conversation_id=$1',
            [s.id],
          )
        ).rows[0].tokens;
      const before = await tokens();
      const google = new GoogleGmailProvider(
        'test-client',
        'test-secret',
        'https://persona.example/callback',
      );
      vi.spyOn(provider, 'profile').mockImplementation((token) =>
        google.profile(token),
      );
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json({ error: { errors: [{ reason }] } }, { status }),
        ),
      );
      now += 300001;
      const checked = (await s.get('/gmail/status').expect(200)).body;
      expect(checked.status).toBe(invalid ? 'reconnect_needed' : 'connected');
      expect(checked.unavailable).toBe(!invalid);
      expect(await tokens()).toBe(invalid ? '' : before);
      expect((await s.get('/session')).body.onboarding.gmail).toBe(
        invalid ? 'not_connected' : 'connected',
      );
    },
  );
  it('marks revoked testing credentials reconnect-needed without losing chat', async () => {
    const s = await session();
    const a = await s.start();
    await s.callback(a.state, 'good');
    now += 8 * 24 * 60 * 60 * 1000;
    revoked = true;
    expect((await s.get('/gmail/status').expect(200)).body.status).toBe(
      'reconnect_needed',
    );
    const restored = await s.get('/session').expect(200);
    expect(restored.body.onboarding.gmail).toBe('not_connected');
    expect(restored.body.turns).toHaveLength(2);
    expect(
      (
        await db.query<{ tokens: string }>(
          'SELECT tokens FROM gmail_connections WHERE conversation_id=$1',
          [s.id],
        )
      ).rows[0].tokens,
    ).toBe('');
  });
});
