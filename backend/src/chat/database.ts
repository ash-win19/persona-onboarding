import { Pool } from 'pg';

export const DATABASE = Symbol('DATABASE');
export interface Sql {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Database extends Sql {
  transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T>;
}
export class PostgresDatabase implements Database {
  private readonly pool: Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 5000,
    });
    this.pool.on('error', () =>
      console.error(JSON.stringify({ code: 'DATABASE_CONNECTION_ERROR' })),
    );
  }
  query<T extends Record<string, unknown>>(sql: string, values?: unknown[]) {
    return this.transaction((connection) => connection.query<T>(sql, values));
  }
  async transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Set this inside the transaction: pooled hosts can ignore startup settings.
      await client.query("SET LOCAL statement_timeout = '10s'");
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
