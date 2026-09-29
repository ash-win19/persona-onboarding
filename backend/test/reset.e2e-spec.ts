import { invitedAccount } from './invited-account.js';
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import { ChatModule } from '../src/chat/chat.module.js';
import { DATABASE, type Database } from '../src/chat/database.js';
import { MODEL, type ReplyModel } from '../src/chat/model.js';
import { CHAT_CONFIG } from '../src/chat/config.js';
import { CLOCK } from '../src/chat/authority.js';
import { migrate } from '../src/chat/migration.js';
import { TOKEN_KEY } from '../src/chat/gmail.js';
import {
  GMAIL_PROVIDER,
  GMAIL_SCOPE,
  type GmailProvider,
} from '../src/chat/gmail-provider.js';
import {
  VOICE_PROVIDER,
  type VoiceEvent,
  type VoiceProvider,
} from '../src/chat/voice-provider.js';
import { Cleanup } from '../src/chat/cleanup.js';

describe('reset and operator cleanup', () => {
  let app: INestApplication, pg: PGlite, db: Database;
  let now = Date.now();
  const origin = 'https://persona.example';
  let voiceEvent: ((event: VoiceEvent) => void) | undefined,
    closed = false;
  let exchangeHold: Promise<void> | undefined;
  let exchanging = false;
  const model: ReplyModel = { reply: async () => 'Saved reply.' };
  const gmail: GmailProvider = {
    available: () => true,
    authorize: (state) => 'https://accounts.google.com/test?state=' + state,
    exchange: async () => {
      exchanging = true;
      await exchangeHold;
      return {
        accessToken: 'private-access',
        refreshToken: 'private-refresh',
        expiresAt: now + 3600000,
        scope: GMAIL_SCOPE,
      };
    },
    refresh: async () => {
      throw new Error('unused');
    },
    profile: async () => 'trial@example.test',
  };
  const voice: VoiceProvider = {
    connect: async (_s, _i, event) => {
      voiceEvent = event;
      closed = false;
      return {
        providerId: 'rtc_reset',
        sdp: 'v=0',
        healthy: () => !closed,
        send: () => {},
        close: async () => {
          closed = true;
        },
      };
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
      .useValue(model)
      .overrideProvider(CHAT_CONFIG)
      .useValue({ origins: [origin], secureCookies: true })
      .overrideProvider(CLOCK)
      .useValue(() => now)
      .overrideProvider(GMAIL_PROVIDER)
      .useValue(gmail)
      .overrideProvider(TOKEN_KEY)
      .useValue(randomBytes(32).toString('base64'))
      .overrideProvider(VOICE_PROVIDER)
      .useValue(voice)
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
    exchangeHold = undefined;
    exchanging = false;
    model.reply = async () => 'Saved reply.';
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
    const post = (
      path: string,
      body: object = {},
      useCookie = cookie,
      epoch = claim.body.control.epoch,
    ) =>
      request(app.getHttpServer())
        .post(path)
        .set('Origin', origin)
        .set('X-Persona-Client', 'web')
        .set('Cookie', useCookie)
        .set('X-Persona-Tab', tabId)
        .set('X-Persona-Epoch', String(epoch))
        .send(body);
    const get = (path: string, useCookie = cookie) =>
      request(app.getHttpServer()).get(path).set('Cookie', useCookie);
    return { post, get, cookie, id: created.body.conversationId };
  }
  async function absent(id: string) {
    for (const table of [
      'turns',
      'submissions',
      'onboarding_facts',
      'onboarding_policy',
      'onboarding_assessments',
      'gmail_attempts',
      'gmail_connections',
      'calls',
    ])
      expect(
        (
          await db.query(`SELECT 1 FROM ${table} WHERE conversation_id=$1`, [
            id,
          ])
        ).rows,
      ).toHaveLength(0);
    expect(
      (await db.query('SELECT 1 FROM conversations WHERE id=$1', [id])).rows,
    ).toHaveLength(0);
  }
  it('deletes all app data and tokens, rotates the session once, and stops the old call', async () => {
    const s = await session();
    model.reply = async (turns, tools) => {
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
        preferences: [
          { goal: 'voice', outcome: 'deferred', evidence: 'voice later' },
        ],
      });
      return 'Sam, we can keep typing.';
    };
    await s
      .post('/turns', {
        submissionId: randomUUID(),
        content: 'Call me Sam, voice later',
      })
      .expect(200);
    const a = await s.post('/gmail/start').expect(200);
    const state = new URL(a.body.url).searchParams.get('state')!;
    await s
      .get('/gmail/callback?' + new URLSearchParams({ state, code: 'good' }))
      .expect(303);
    const call = randomUUID();
    await s.post('/calls/start', { id: call, sdp: 'v=0' }).expect(200);
    const operationId = randomUUID();
    const fresh = await s.post('/reset', { operationId }).expect(200);
    const cookie = fresh.headers['set-cookie'][0];
    expect(fresh.body.conversationId).not.toBe(s.id);
    expect(fresh.body.turns).toHaveLength(0);
    expect(fresh.body.onboarding.facts.userName.value).toBeNull();
    expect(closed).toBe(true);
    await absent(s.id);
    const repeatOld = await s.post('/reset', { operationId }).expect(200);
    expect(repeatOld.body.conversationId).toBe(fresh.body.conversationId);
    const repeatNew = await s
      .post('/reset', { operationId }, cookie)
      .expect(200);
    expect(repeatNew.body.conversationId).toBe(fresh.body.conversationId);
    voiceEvent!({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'late',
      transcript: 'Do not restore me.',
    });
    await s
      .get('/gmail/callback?' + new URLSearchParams({ state, code: 'old' }))
      .expect(401);
    await s
      .post(
        '/turns',
        { submissionId: randomUUID(), content: 'Old tab' },
        cookie,
      )
      .expect(403);
    model.reply = async () => 'Fresh reply.';
    const next = await s
      .post(
        '/turns',
        { submissionId: randomUUID(), content: 'New conversation' },
        cookie,
        fresh.body.control.epoch,
      )
      .expect(200);
    expect(next.body.turns).toHaveLength(2);
  });
  it('fences a delayed model completion after reset', async () => {
    const s = await session();
    let release!: () => void,
      started = false;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    model.reply = async () => {
      started = true;
      await hold;
      return 'Old reply';
    };
    const pending = s
      .post('/turns', { submissionId: randomUUID(), content: 'Old request' })
      .then((r) => r);
    await vi.waitFor(() => expect(started).toBe(true));
    const fresh = await s
      .post('/reset', { operationId: randomUUID() })
      .expect(200);
    release();
    await pending;
    await absent(s.id);
    expect(
      (await s.get('/session', fresh.headers['set-cookie'][0])).body.turns,
    ).toHaveLength(0);
  });
  it('fences a Gmail exchange that finishes after reset', async () => {
    const s = await session();
    let release!: () => void;
    exchangeHold = new Promise<void>((r) => {
      release = r;
    });
    const a = await s.post('/gmail/start').expect(200);
    const state = new URL(a.body.url).searchParams.get('state')!;
    const callback = s
      .get('/gmail/callback?' + new URLSearchParams({ state, code: 'held' }))
      .then((r) => r);
    await vi.waitFor(() => expect(exchanging).toBe(true));
    const fresh = await s
      .post('/reset', { operationId: randomUUID() })
      .expect(200);
    release();
    await callback;
    await absent(s.id);
    const saved = await s.get('/session', fresh.headers['set-cookie'][0]);
    expect(saved.body.turns).toHaveLength(0);
    expect(saved.body.onboarding.gmail).toBe('not_connected');
  });
  it('allows cleanup of a crashed call after its deadline and owner lease expire', async () => {
    const s = await session();
    const id = randomUUID();
    await db.query(
      "INSERT INTO calls(id,conversation_id,owner_tab,owner_epoch,instance_id,status,created_at,deadline) VALUES($1,$2,$3,1,$4,'active',$5,$6)",
      [
        id,
        s.id,
        randomUUID(),
        randomUUID(),
        new Date(now),
        new Date(now + 600000),
      ],
    );
    now += 600001;
    const cleanup = new Cleanup(db, () => now);
    expect((await cleanup.preview(new Date(now))).selected).toContain(s.id);
    expect(await cleanup.remove([s.id])).toMatchObject({
      removed: 1,
      failed: 0,
    });
    await absent(s.id);
  });
  it('previews abandoned conversations, skips active owners, and purges only old diagnostics', async () => {
    const abandoned = await session(),
      active = await session();
    now += 1800000;
    await db.query('UPDATE conversations SET owner_until=$2 WHERE id=$1', [
      active.id,
      new Date(now + 15000),
    ]);
    const cleanup = new Cleanup(db, () => now);
    const preview = await cleanup.preview(new Date(now - 60000));
    expect(preview.selected).toContain(abandoned.id);
    expect(preview.skipped).toContain(active.id);
    expect(await cleanup.remove([abandoned.id, active.id])).toMatchObject({
      removed: 1,
      skipped: 1,
      failed: 0,
    });
    await absent(abandoned.id);
    expect(await cleanup.remove([abandoned.id])).toMatchObject({ missing: 1 });
    const recent = randomUUID(),
      old = randomUUID();
    await db.query(
      'INSERT INTO operational_events(id,at,code,subject_id) VALUES($1,$2,$3,$4),($5,$6,$3,$4)',
      [
        old,
        new Date(now - 8 * 86400000),
        'CALL_ENDED',
        active.id,
        recent,
        new Date(now),
      ],
    );
    expect((await cleanup.purgeDiagnostics()).removed).toBeGreaterThanOrEqual(
      1,
    );
    expect(
      (
        await db.query('SELECT id FROM operational_events WHERE id=$1', [
          recent,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (await db.query('SELECT id FROM conversations WHERE id=$1', [active.id]))
        .rows,
    ).toHaveLength(1);
  });
});
