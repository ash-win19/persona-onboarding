import {
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DATABASE, type Database } from './database.js';
import { CLOCK, credentialHash, type Clock } from './authority.js';
import { ChatService } from './chat.service.js';
import { Calls } from './calls.js';
import { normalizeEmail } from './account-admin.js';
import { verifyPassword } from './password.js';
import { lockSession } from './account-sessions.js';
import { removeConversation } from './reset.js';
import { CONVERSATION_MEMORY, type ConversationMemory } from './memory.js';
import type { Sql } from './database.js';

export const SESSION_AGE = 30 * 86400 * 1000;
type Account = {
  id: string;
  email: string;
  password_hash: string;
  conversation_id: string | null;
  fresh_start: boolean;
};

@Injectable()
export class Accounts {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly now: Clock,
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(Calls) private readonly calls: Calls,
    @Inject(CONVERSATION_MEMORY) private readonly memory: ConversationMemory,
  ) {}

  // Gives a fresh-start account a brand-new conversation. The old one is deleted
  // with its turns, Gmail connection and calls; the caller then closes those calls
  // and forgets the old memory thread once the transaction commits.
  private async replaceConversation(sql: Sql, account: Account) {
    const callIds = account.conversation_id
      ? await removeConversation(sql, account.conversation_id)
      : [];
    const id = await this.chat.create(sql);
    await sql.query('UPDATE accounts SET conversation_id=$2 WHERE id=$1', [
      account.id,
      id,
    ]);
    return { id, removed: account.conversation_id, callIds };
  }

  private async discard(removed: string | null, callIds: string[]) {
    await this.calls.closeDeleted(callIds);
    if (removed) await this.memory.forget(removed);
  }

  private async throttle(email: string) {
    const time = new Date(this.now());
    const allowed = await this.db.transaction(async (sql) => {
      await sql.query('DELETE FROM login_limits WHERE window_start<$1', [
        new Date(this.now() - 86400000),
      ]);
      let accepted = true;
      for (const [key, limit, duration] of [
        ['global', 60, 60000],
        [credentialHash(email), 10, 15 * 60000],
      ] as const) {
        const result = await sql.query<{ attempts: number }>(
          `INSERT INTO login_limits(key,attempts,window_start) VALUES($1,1,$2)
           ON CONFLICT(key) DO UPDATE SET
           attempts=CASE WHEN login_limits.window_start<=$3 THEN 1 ELSE login_limits.attempts+1 END,
           window_start=CASE WHEN login_limits.window_start<=$3 THEN $2 ELSE login_limits.window_start END
           RETURNING attempts`,
          [key, time, new Date(this.now() - duration)],
        );
        if (result.rows[0].attempts > limit) accepted = false;
      }
      return accepted;
    });
    if (!allowed) throw new HttpException('TRY_LATER', 429);
  }

  async login(email: string, password: string) {
    let normalized: string;
    try {
      normalized = normalizeEmail(email);
    } catch {
      throw new UnauthorizedException();
    }
    await this.throttle(normalized);
    const candidate = (
      await this.db.query<Account>('SELECT * FROM accounts WHERE email=$1', [
        normalized,
      ])
    ).rows[0];
    if (!(await verifyPassword(password, candidate?.password_hash)))
      throw new UnauthorizedException();
    const token = randomBytes(32).toString('base64url');
    const replaced = await this.db.transaction(async (sql) => {
      const account = (
        await sql.query<Account>(
          'SELECT * FROM accounts WHERE id=$1 FOR UPDATE',
          [candidate.id],
        )
      ).rows[0];
      // A password reset racing this sign-in must not mint a session for the old password.
      if (!account || account.password_hash !== candidate.password_hash)
        throw new UnauthorizedException();
      const replaced =
        !account.conversation_id || account.fresh_start
          ? await this.replaceConversation(sql, account)
          : undefined;
      await sql.query('DELETE FROM account_sessions WHERE expires_at<=$1', [
        new Date(this.now()),
      ]);
      await sql.query(
        'INSERT INTO account_sessions(token_hash,account_id,expires_at,family_hash) VALUES($1,$2,$3,$1)',
        [credentialHash(token), account.id, new Date(this.now() + SESSION_AGE)],
      );
      return replaced;
    });
    if (replaced) await this.discard(replaced.removed, replaced.callIds);
    return { token, snapshot: await this.chat.read(token) };
  }

  // Called once per page load. Ordinary accounts keep their conversation; a
  // fresh-start test account begins again as a new user every time.
  async freshStart(token: string | undefined) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException();
    const result = await this.db.transaction(async (sql) => {
      const account = (
        await sql.query<Account>(
          `SELECT a.* FROM accounts a JOIN account_sessions s ON s.account_id=a.id
           WHERE s.token_hash=$1 AND s.expires_at>$2 AND s.revoked_at IS NULL FOR UPDATE OF a`,
          [credentialHash(token), new Date(this.now())],
        )
      ).rows[0];
      if (!account) throw new UnauthorizedException();
      if (!account.fresh_start)
        return { id: account.conversation_id, removed: null, callIds: [] };
      return this.replaceConversation(sql, account);
    });
    await this.discard(result.removed, result.callIds);
    return { conversationId: result.id };
  }

  async read(token: string | undefined) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException();
    const account = (
      await this.db.query<{
        id: string;
        email: string;
        conversation_id: string | null;
      }>(
        `SELECT a.id,a.email,a.conversation_id FROM accounts a JOIN account_sessions s ON s.account_id=a.id
       WHERE s.token_hash=$1 AND s.expires_at>$2 AND s.revoked_at IS NULL`,
        [credentialHash(token), new Date(this.now())],
      )
    ).rows[0];
    if (!account) throw new UnauthorizedException();
    return account;
  }

  async logout(token: string | undefined) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const callIds = await this.db.transaction(async (sql) => {
      const session = await lockSession(sql, credentialHash(token), this.now());
      if (!session) return [];
      const account = (
        await sql.query<{ conversation_id: string | null }>(
          'SELECT conversation_id FROM accounts WHERE id=$1',
          [session.account_id],
        )
      ).rows[0];
      await sql.query('DELETE FROM account_sessions WHERE family_hash=$1', [
        session.family_hash,
      ]);
      if (!account?.conversation_id) return [];
      await sql.query(
        'UPDATE conversations SET owner_until=NULL,owner_epoch=owner_epoch+1 WHERE id=$1',
        [account.conversation_id],
      );
      const calls = await sql.query<{ id: string }>(
        "UPDATE calls SET status='ended',reason='signed_out',ended_at=$2 WHERE conversation_id=$1 AND status IN ('connecting','active') RETURNING id",
        [account.conversation_id, new Date(this.now())],
      );
      await sql.query(
        "UPDATE turns SET delivery='interrupted' WHERE conversation_id=$1 AND channel='voice' AND role='assistant' AND delivery='generated'",
        [account.conversation_id],
      );
      return calls.rows.map((call) => call.id);
    });
    await this.calls.closeDeleted(callIds);
  }
}
