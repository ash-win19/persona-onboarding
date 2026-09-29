import { PostgresDatabase } from './chat/database.js';
import { migrate } from './chat/migration.js';
import { required } from './chat/config.js';
import { migrateMemory } from './chat/memory.js';

const db = new PostgresDatabase(required('DATABASE_URL'));
try {
  await migrate(db);
  // Memory is optional: a failure here must not block the app from starting.
  await migrateMemory().catch(() =>
    console.error(JSON.stringify({ code: 'MEMORY_MIGRATION_FAILED' })),
  );
  console.log('Database migrations complete.');
} catch {
  console.error('MIGRATION_FAILED');
  process.exitCode = 1;
} finally {
  await db.onModuleDestroy();
}
