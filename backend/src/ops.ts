import { PostgresDatabase } from './chat/database.js';
import { Cleanup } from './chat/cleanup.js';
import { required } from './chat/config.js';
import { createConversationMemory } from './chat/memory.js';
const [command, ...args] = process.argv.slice(2);
const value = (name: string) => args[args.indexOf(name) + 1];
if (!['preview', 'remove', 'purge-diagnostics'].includes(command))
  throw new Error(
    'Use preview --before ISO_DATE, remove --ids UUID,UUID --confirm, or purge-diagnostics --confirm. DATABASE_URL is the operator credential.',
  );
if (command !== 'preview' && !args.includes('--confirm'))
  throw new Error('Explicit --confirm is required. Run preview first.');
const db = new PostgresDatabase(required('DATABASE_URL'));
const memory = await createConversationMemory(db);
try {
  const cleanup = new Cleanup(db, undefined, memory);
  const result =
    command === 'preview'
      ? await cleanup.preview(new Date(value('--before')))
      : command === 'remove'
        ? await cleanup.remove(
            (value('--ids') ?? '').split(',').filter(Boolean),
          )
        : await cleanup.purgeDiagnostics();
  console.log(JSON.stringify(result, null, 2));
} finally {
  await memory.onModuleDestroy?.();
  await db.onModuleDestroy();
}
