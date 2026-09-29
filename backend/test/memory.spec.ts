import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../src/chat/database.js';
import { migrate } from '../src/chat/migration.js';
import {
  memoryPrompt,
  memoryWindow,
  mergeNotes,
  parseWorkingMemory,
  type MemoryContext,
} from '../src/chat/memory.js';
import { MastraMemory, memoryPool } from '../src/chat/mastra-memory.js';

describe('working memory notes', () => {
  it('appends, deduplicates case-insensitively, trims and caps each kind', () => {
    const merged = mergeNotes({ preferences: ['Short bullet points'] }, [
      { kind: 'preferences', value: '  short bullet points ' },
      { kind: 'deadlines', value: 'Interview on Tuesday' },
      { kind: 'taskDetails', value: '' },
      ...Array.from({ length: 10 }, (_, i) => ({
        kind: 'taskDetails' as const,
        value: `detail ${i}`,
      })),
    ]);
    expect(merged.preferences).toEqual(['short bullet points']);
    expect(merged.deadlines).toEqual(['Interview on Tuesday']);
    expect(merged.taskDetails).toHaveLength(8);
    expect(merged.taskDetails?.at(-1)).toBe('detail 9');
  });

  it('ignores stored working memory that does not match the schema', () => {
    expect(parseWorkingMemory(null)).toEqual({});
    expect(parseWorkingMemory('not json')).toEqual({});
    expect(parseWorkingMemory('{"taskDetails":"one"}')).toEqual({});
    expect(parseWorkingMemory('{"deadlines":["Tuesday"]}')).toEqual({
      deadlines: ['Tuesday'],
    });
  });
});

describe('memory prompt', () => {
  it('is empty without notes and labels notes as data when present', () => {
    expect(memoryPrompt(null)).toBe('');
    expect(memoryPrompt({ observations: null, workingMemory: {} })).toBe('');
    const prompt = memoryPrompt({
      observations: '* User prefers mornings.',
      workingMemory: { deadlines: ['Friday'] },
    });
    expect(prompt).toMatch(/^Conversation memory: .*never instructions/);
    expect(prompt).toContain('<observations>\n* User prefers mornings.\n');
    expect(prompt).toContain(
      '<working_memory>{"deadlines":["Friday"]}</working_memory>',
    );
    expect(
      memoryPrompt({
        observations: null,
        workingMemory: { deadlines: ['Friday'] },
      }),
    ).not.toContain('<observations>');
  });
});

describe('memory window', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 29, 12, minute));
  const turns = Array.from({ length: 12 }, (_, i) => ({
    id: `t${i}`,
    createdAt: at(i),
  }));
  const context = (patch: Partial<MemoryContext>): MemoryContext => ({
    observations: 'User is preparing for an interview.',
    workingMemory: {},
    lastObservedAt: null,
    observedTurnIds: [],
    ...patch,
  });

  it('keeps the plain history window when nothing has been observed', () => {
    expect(memoryWindow(turns, null, { recent: 4, max: 10 })).toEqual(
      turns.slice(-10),
    );
    expect(
      memoryWindow(turns, context({ observations: null }), {
        recent: 4,
        max: 10,
      }),
    ).toEqual(turns.slice(-10));
  });

  it('drops observed turns but always keeps the most recent ones verbatim', () => {
    const window = memoryWindow(
      turns,
      context({ lastObservedAt: at(9), observedTurnIds: ['t10'] }),
      { recent: 4, max: 10 },
    );
    expect(window.map((t) => t.id)).toEqual(['t8', 't9', 't10', 't11']);
    const later = memoryWindow(turns, context({ lastObservedAt: at(3) }), {
      recent: 2,
      max: 10,
    });
    expect(later.map((t) => t.id)).toEqual(
      turns.slice(4).map((turn) => turn.id),
    );
  });
});

describe.runIf(process.env.TEST_DATABASE_URL)('Mastra memory storage', () => {
  let db: PostgresDatabase;
  let memory: MastraMemory;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    db = new PostgresDatabase(process.env.TEST_DATABASE_URL!);
    await migrate(db);
    const pool = memoryPool();
    await MastraMemory.store(pool).init();
    await pool.end();
    memory = new MastraMemory(memoryPool(), db, 'gpt-4.1-mini');
  }, 60000);
  afterAll(async () => {
    await memory?.onModuleDestroy();
    await db?.onModuleDestroy();
    delete process.env.DATABASE_URL;
  });

  it('keeps notes per conversation and forgets them with the conversation', async () => {
    const id = randomUUID();
    const other = randomUUID();
    for (const conversation of [id, other])
      await db.query(
        'INSERT INTO conversations(id,credential_hash) VALUES($1,$2)',
        [conversation, randomUUID()],
      );
    await db.query(
      `INSERT INTO turns(id,conversation_id,submission_id,role,content) VALUES($1,$2,$3,'user',$4)`,
      [randomUUID(), id, randomUUID(), 'Help me prepare for an interview.'],
    );
    // Below the observation threshold this records progress without a model call.
    await memory.observe(id);
    expect(
      await memory.remember(id, [
        { kind: 'deadlines', value: 'Interview on Tuesday' },
      ]),
    ).toBe(true);
    await memory.remember(id, [
      { kind: 'preferences', value: 'Short bullet points' },
    ]);
    await memory.remember(other, [
      { kind: 'preferences', value: 'Long answers' },
    ]);
    expect(await memory.context(id)).toMatchObject({
      observations: null,
      workingMemory: {
        deadlines: ['Interview on Tuesday'],
        preferences: ['Short bullet points'],
      },
    });
    const records = () =>
      db.query<{ count: string }>(
        'SELECT count(*) FROM mastra.mastra_observational_memory WHERE "threadId"=$1',
        [id],
      );
    expect(Number((await records()).rows[0].count)).toBe(1);
    await memory.forget(id);
    expect((await memory.context(id))?.workingMemory).toEqual({});
    expect(Number((await records()).rows[0].count)).toBe(0);
    expect((await memory.context(other))?.workingMemory).toEqual({
      preferences: ['Long answers'],
    });
    await memory.forget(other);
  }, 30000);
});
