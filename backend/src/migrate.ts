import { PostgresDatabase } from './chat/database.js';
import { migrate } from './chat/migration.js';
import { required } from './chat/config.js';

const db = new PostgresDatabase(required('DATABASE_URL'));
try {
  await migrate(db);
  console.log('Database migrations complete.');
} catch {
  console.error('MIGRATION_FAILED');
  process.exitCode = 1;
} finally {
  await db.onModuleDestroy();
}
