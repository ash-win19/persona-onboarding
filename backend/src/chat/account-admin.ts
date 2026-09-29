import { randomUUID } from 'node:crypto';
import type { Database } from './database.js';
import { hashPassword } from './password.js';

export function normalizeEmail(email: string) {
  const value = email.trim().toLowerCase();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    throw new Error('Use a valid email address.');
  return value;
}

export async function createAccount(
  db: Database,
  email: string,
  password: string,
) {
  const normalized = normalizeEmail(email);
  const hash = await hashPassword(password);
  await db.query(
    'INSERT INTO accounts(id,email,password_hash) VALUES($1,$2,$3)',
    [randomUUID(), normalized, hash],
  );
}

export async function resetPassword(
  db: Database,
  email: string,
  password: string,
) {
  const normalized = normalizeEmail(email);
  const hash = await hashPassword(password);
  await db.transaction(async (sql) => {
    const account = (
      await sql.query<{ id: string; conversation_id: string | null }>(
        'UPDATE accounts SET password_hash=$2 WHERE email=$1 RETURNING id,conversation_id',
        [normalized, hash],
      )
    ).rows[0];
    if (!account) throw new Error('Account not found.');
    await sql.query('DELETE FROM account_sessions WHERE account_id=$1', [
      account.id,
    ]);
    await sql.query(
      'UPDATE conversations SET owner_until=NULL,owner_epoch=owner_epoch+1 WHERE id=$1',
      [account.conversation_id],
    );
  });
}
