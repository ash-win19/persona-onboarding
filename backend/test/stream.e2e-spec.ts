import { invitedAccount } from './invited-account.js';
import { streamText } from './fake-responses.js';
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ChatModule } from '../src/chat/chat.module.js';
import { DATABASE, type Database } from '../src/chat/database.js';
import { MODEL, OpenAIReplyModel, type ReplyModel } from '../src/chat/model.js';
import { CHAT_CONFIG } from '../src/chat/config.js';
import { migrate } from '../src/chat/migration.js';

type Event = { event: string; data: any };
function events(text: string): Event[] {
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const [event, data] = block.split('\n');
      return {
        event: event.slice('event: '.length),
        data: JSON.parse(data.slice('data: '.length)),
      };
    });
}

describe('streamed text replies', () => {
  let app: INestApplication, pg: PGlite, base: string;
  const origin = 'https://persona.example';
  const model: ReplyModel = { reply: async () => 'Saved reply.' };
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
      .compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });

  async function session() {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .send(await invitedAccount(app))
      .expect(200);
    const cookie: string = login.headers['set-cookie'][0];
    const send = (content: string, submissionId = randomUUID()) =>
      request(app.getHttpServer())
        .post('/turns')
        .set('Origin', origin)
        .set('X-Persona-Client', 'web')
        .set('Accept', 'text/event-stream')
        .set('Cookie', cookie)
        .send({ submissionId, content })
        .buffer(true)
        .parse((res, done) => {
          let text = '';
          res.on('data', (chunk: Buffer) => (text += chunk.toString()));
          res.on('end', () => done(null, text));
        });
    return { cookie, send };
  }

  it('sends the saved message, reply deltas, then the saved reply', async () => {
    model.reply = async (_turns, _tools, onDelta) => {
      onDelta?.('Here is ');
      onDelta?.('a plan.');
      return 'Here is a plan.';
    };
    const s = await session();
    const res = await s.send('Help me plan my week.').expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(res.headers['cache-control']).toBe('no-store, no-transform');
    const list = events(res.body);
    expect(list.map((e) => e.event)).toEqual([
      'snapshot',
      'delta',
      'delta',
      'done',
    ]);
    expect(list[0].data.operation.status).toBe('generating');
    expect(list[0].data.turns.at(-1)).toMatchObject({
      role: 'user',
      content: 'Help me plan my week.',
    });
    expect(list[1].data.text + list[2].data.text).toBe('Here is a plan.');
    expect(list[3].data.operation.status).toBe('completed');
    expect(list[3].data.turns.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Here is a plan.',
    });
  });

  it('delivers deltas before the reply finishes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    model.reply = async (_turns, _tools, onDelta) => {
      onDelta?.('First words');
      await gate;
      return 'First words, then the rest.';
    };
    const s = await session();
    const response = await fetch(`${base}/turns`, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        Origin: origin,
        'X-Persona-Client': 'web',
        Cookie: s.cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ submissionId: randomUUID(), content: 'Go.' }),
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('event: delta')) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Stream ended before a delta');
      text += decoder.decode(value, { stream: true });
    }
    expect(text).not.toContain('event: done');
    release();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(events(text).at(-1)!.data.turns.at(-1).content).toBe(
      'First words, then the rest.',
    );
  });

  it('keeps JSON for clients that do not ask for a stream', async () => {
    model.reply = async (_turns, _tools, onDelta) => {
      onDelta?.('ignored');
      return 'Plain reply.';
    };
    const s = await session();
    const res = await request(app.getHttpServer())
      .post('/turns')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .set('Cookie', s.cookie)
      .send({ submissionId: randomUUID(), content: 'Hello there.' })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.turns.at(-1).content).toBe('Plain reply.');
  });

  it('keeps status codes before saving, and JSON for a duplicate', async () => {
    await request(app.getHttpServer())
      .post('/turns')
      .set('Origin', origin)
      .set('X-Persona-Client', 'web')
      .set('Accept', 'text/event-stream')
      .send({ submissionId: randomUUID(), content: 'Hello' })
      .expect(401);
    const s = await session();
    await s.send('   ').expect(400);
    model.reply = async () => 'Once.';
    const id = randomUUID();
    await s.send('Only once.', id).expect(200);
    const again = await s.send('Only once.', id).expect(200);
    expect(again.headers['content-type']).toMatch(/^application\/json/);
    const snapshot = JSON.parse(again.body);
    expect(
      snapshot.turns.filter((t: any) => t.role === 'assistant').at(-1),
    ).toMatchObject({ content: 'Once.' });
  });

  it('finishes the stream with a failed operation when the reply fails', async () => {
    model.reply = async (_turns, _tools, onDelta) => {
      onDelta?.('Partial');
      throw new Error('MODEL_INCOMPLETE');
    };
    const s = await session();
    const list = events((await s.send('Try this.').expect(200)).body);
    expect(list.map((e) => e.event)).toEqual(['snapshot', 'delta', 'done']);
    expect(list.at(-1)!.data.operation).toMatchObject({
      status: 'failed',
      errorCode: 'REPLY_UNAVAILABLE',
    });
    expect(list.at(-1)!.data.turns.at(-1).role).toBe('user');
  });

  it('streams the saved onboarding reply without requesting another model answer', async () => {
    let streamedRequests = 0;
    const provider = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      if (input.stream) {
        streamedRequests++;
        return streamText(res, [
          'Nova it',
          ' is. What is your',
          ' name? Here is a tip.',
        ]);
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
              call_id: 'call_name',
              arguments: JSON.stringify({
                expectedRevision: 1,
                askOnboarding: true,
                changes: [
                  {
                    goal: 'agentName',
                    action: 'set',
                    value: 'Nova',
                    evidence: 'Call yourself Nova',
                  },
                ],
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
    const adapter = new OpenAIReplyModel(
      'test-key',
      'gpt-4.1-mini',
      `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`,
    );
    model.reply = adapter.reply.bind(adapter);
    try {
      const s = await session();
      const list = events(
        (await s.send('Call yourself Nova.').expect(200)).body,
      );
      const streamed = list
        .filter((e) => e.event === 'delta')
        .map((e) => e.data.text)
        .join('');
      const saved = list.at(-1)!.data.turns.at(-1);
      expect(saved.role).toBe('assistant');
      expect(saved.content).toContain('Start a call');
      expect(list.at(-1)!.data.onboarding.facts.agentName.value).toBe('Nova');
      expect(streamedRequests).toBe(0);
      expect(streamed).toBe(saved.content);
      expect(streamed).not.toContain('What is your name');
    } finally {
      await new Promise<void>((resolve, reject) =>
        provider.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
