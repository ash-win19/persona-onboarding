import type { Sql } from './database.js';

type Session = { account_id: string; family_hash: string; expires_at: Date };

// Reset rotates tokens, but sign-out must revoke the whole original session,
// including replacements whose response has not reached the browser yet.
export async function lockSession(sql: Sql, tokenHash: string, now: number) {
  const read = async () =>
    (
      await sql.query<Session>(
        'SELECT account_id,family_hash,expires_at FROM account_sessions WHERE token_hash=$1 AND expires_at>$2',
        [tokenHash, new Date(now)],
      )
    ).rows[0];
  const session = await read();
  if (!session) return undefined;
  await sql.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    'account-session:' + session.family_hash,
  ]);
  return read();
}
