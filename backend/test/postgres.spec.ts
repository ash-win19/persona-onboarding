import { PostgresDatabase } from '../src/chat/database.js';

describe.runIf(process.env.TEST_DATABASE_URL)('Postgres adapter', () => {
  let db: PostgresDatabase;
  beforeEach(() => {
    db = new PostgresDatabase(process.env.TEST_DATABASE_URL!);
  });
  afterEach(async () => {
    await db.onModuleDestroy();
  });

  it('bounds each query within its transaction and recovers after cancellation', async () => {
    const setting = await db.query<{ statement_timeout: string }>(
      'SHOW statement_timeout',
    );
    expect(setting.rows[0].statement_timeout).toBe('10s');
    await expect(db.query('SELECT pg_sleep(11)')).rejects.toThrow(
      /statement timeout/,
    );
    const healthy = await db.query<{ healthy: number }>('SELECT 1 AS healthy');
    expect(healthy.rows[0].healthy).toBe(1);
  }, 20000);
});
