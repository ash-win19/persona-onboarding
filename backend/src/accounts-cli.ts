import { readFile } from 'node:fs/promises';
import { PostgresDatabase } from './chat/database.js';
import { required } from './chat/config.js';
import { createAccount, resetPassword } from './chat/account-admin.js';

const [command, email, option, path] = process.argv.slice(2);
if (
  !['create', 'reset-password', 'list'].includes(command) ||
  (command !== 'list' && (!email || option !== '--password-file' || !path))
) {
  console.error(
    'Use: npm run account -- create EMAIL --password-file PATH | reset-password EMAIL --password-file PATH | list',
  );
  process.exitCode = 1;
} else {
  const db = new PostgresDatabase(required('DATABASE_URL'));
  try {
    if (command === 'list') {
      const result = await db.query(
        'SELECT email,created_at FROM accounts ORDER BY created_at',
      );
      console.log(JSON.stringify(result.rows, null, 2));
    } else {
      const password = (await readFile(path, 'utf8')).replace(/\r?\n$/, '');
      await (command === 'create' ? createAccount : resetPassword)(
        db,
        email,
        password,
      );
      console.log(
        command === 'create'
          ? 'Account created.'
          : 'Password updated; previous sessions revoked.',
      );
    }
  } catch {
    console.error(
      'Account operation failed. Check the email, password file, and database configuration. Creating an existing email does not reset its password.',
    );
    process.exitCode = 1;
  } finally {
    await db.onModuleDestroy();
  }
}
