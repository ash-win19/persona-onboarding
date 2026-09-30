import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Authority, type Owner } from './authority.js';
import { DATABASE, type Database } from './database.js';
import {
  CalendarError,
  CalendarProvider,
  type GoogleTokens,
} from './calendar-provider.js';
import { openGoogleToken, sealGoogleToken } from './google-token-vault.js';

type Connection = {
  conversation_id: string;
  generation: string;
  subject: string;
  email: string;
  tokens: string;
  status: string;
};
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class Calendar {
  private readonly key = process.env.GMAIL_TOKEN_KEY ?? '';
  private readonly refreshes = new Map<
    string,
    Promise<{ token: string; subject: string; email: string }>
  >();
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(Authority) private readonly authority: Authority,
    @Inject(CalendarProvider) readonly provider: CalendarProvider,
  ) {}
  enabled() {
    return process.env.CALENDAR_SCHEDULING_ENABLED === 'true';
  }
  available() {
    return (
      this.enabled() &&
      this.provider.available() &&
      Buffer.from(this.key, 'base64').length === 32
    );
  }
  async connection(id: string) {
    return (
      await this.db.query<Connection>(
        'SELECT * FROM calendar_connections WHERE conversation_id=$1',
        [id],
      )
    ).rows[0];
  }
  async status(id: string) {
    const connection = await this.connection(id);
    const attempt = (
      await this.db.query<{ id: string; status: string }>(
        "SELECT id,CASE WHEN status IN ('pending','exchanging') AND expires_at<=now() THEN 'expired' ELSE status END AS status FROM calendar_attempts WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 1",
        [id],
      )
    ).rows[0];
    return {
      available: this.available(),
      enabled: this.enabled(),
      status: connection?.status ?? 'not_connected',
      email: connection?.email ?? null,
      attempt: attempt ?? null,
    };
  }
  async start(credential: string | undefined, owner: Owner) {
    if (!this.available())
      throw new ConflictException('CALENDAR_NOT_CONFIGURED');
    const id = randomUUID(),
      state = randomBytes(32).toString('base64url'),
      verifier = randomBytes(32).toString('base64url'),
      nonce = randomBytes(32).toString('base64url');
    await this.db.transaction(async (sql) => {
      const c = await this.authority.authorize(credential, sql, true);
      this.authority.assertOwner(c, owner);
      await sql.query(
        "UPDATE calendar_attempts SET status='superseded',verifier=NULL WHERE conversation_id=$1 AND status IN ('pending','exchanging')",
        [c.id],
      );
      await sql.query(
        "INSERT INTO calendar_attempts(id,conversation_id,state_hash,verifier,nonce_hash,status,expires_at) VALUES($1,$2,$3,$4,$5,'pending',now()+interval '10 minutes')",
        [
          id,
          c.id,
          hash(state),
          sealGoogleToken(this.key, verifier),
          hash(nonce),
        ],
      );
    });
    return {
      attemptId: id,
      url: this.provider.authorize(
        state,
        createHash('sha256').update(verifier).digest('base64url'),
        nonce,
      ),
    };
  }
  async cancel(credential: string | undefined, owner: Owner, id: string) {
    await this.db.transaction(async (sql) => {
      const c = await this.authority.authorize(credential, sql, true);
      this.authority.assertOwner(c, owner);
      await sql.query(
        "UPDATE calendar_attempts SET status='closed',verifier=NULL WHERE conversation_id=$1 AND id=$2 AND status='pending'",
        [c.id, id],
      );
    });
    return { ok: true };
  }
  async callback(
    credential: string | undefined,
    state: string,
    code?: string,
    error?: string,
  ) {
    const c = await this.authority.authorize(credential);
    const attempt = (
      await this.db.query<{ id: string; verifier: string; nonce_hash: string }>(
        "UPDATE calendar_attempts SET status='exchanging' WHERE conversation_id=$1 AND state_hash=$2 AND status='pending' AND expires_at>now() RETURNING id,verifier,nonce_hash",
        [c.id, hash(state)],
      )
    ).rows[0];
    if (!attempt) return 'invalid';
    let result = error === 'access_denied' ? 'denied' : 'failed';
    try {
      if (error || !code) return result;
      const tokens = await this.provider.exchange(
        code,
        openGoogleToken<string>(this.key, attempt.verifier),
      );
      if (!tokens.idToken || !tokens.refreshToken)
        throw new CalendarError('GRANT_INCOMPLETE');
      const identity = await this.provider.identity(tokens.idToken);
      if (!identity.nonce || hash(identity.nonce) !== attempt.nonce_hash)
        throw new CalendarError('IDENTITY_INVALID');
      await this.provider.verifyAccess(tokens.accessToken);
      delete tokens.idToken;
      result = await this.db.transaction(async (sql) => {
        const exists = await sql.query(
          'SELECT id FROM conversations WHERE id=$1 FOR UPDATE',
          [c.id],
        );
        if (!exists.rows.length) return 'superseded';
        const accepted = await sql.query(
          "UPDATE calendar_attempts SET status='connected',verifier=NULL WHERE id=$1 AND status='exchanging' AND expires_at>now() RETURNING id",
          [attempt.id],
        );
        if (!accepted.rows.length) return 'superseded';
        await sql.query(
          `INSERT INTO calendar_connections(conversation_id,generation,subject,email,tokens,status) VALUES($1,$2,$3,$4,$5,'connected')
          ON CONFLICT(conversation_id) DO UPDATE SET generation=$2,subject=$3,email=$4,tokens=$5,status='connected',updated_at=now()`,
          [
            c.id,
            attempt.id,
            identity.subject,
            identity.email,
            sealGoogleToken(this.key, tokens),
          ],
        );
        return 'connected';
      });
    } catch {
      result = 'failed';
    } finally {
      await this.db.query(
        "UPDATE calendar_attempts SET status=$2,verifier=NULL WHERE id=$1 AND status='exchanging'",
        [attempt.id, result],
      );
    }
    return result;
  }
  async credentials(id: string, subject?: string | null) {
    let pending = this.refreshes.get(id);
    if (!pending) {
      pending = this.loadCredentials(id);
      this.refreshes.set(id, pending);
      void pending
        .finally(() => this.refreshes.delete(id))
        .catch(() => undefined);
    }
    const value = await pending;
    if (subject && value.subject !== subject)
      throw new CalendarError('ACCOUNT_MISMATCH');
    return value;
  }
  private async loadCredentials(id: string) {
    // The row lock serializes token rotation across multiple backend instances.
    return this.db.transaction(async (sql) => {
      const c = (
        await sql.query<Connection>(
          'SELECT * FROM calendar_connections WHERE conversation_id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      if (!c || c.status !== 'connected')
        throw new CalendarError('RECONNECT_REQUIRED');
      let tokens = openGoogleToken<GoogleTokens>(this.key, c.tokens);
      if (tokens.expiresAt < Date.now() + 60000) {
        if (!tokens.refreshToken) throw new CalendarError('RECONNECT_REQUIRED');
        const next = await this.provider.refresh(tokens.refreshToken);
        tokens = {
          ...next,
          refreshToken: next.refreshToken ?? tokens.refreshToken,
        };
        await sql.query(
          'UPDATE calendar_connections SET tokens=$2,updated_at=now() WHERE conversation_id=$1 AND generation=$3',
          [id, sealGoogleToken(this.key, tokens), c.generation],
        );
      }
      return { token: tokens.accessToken, subject: c.subject, email: c.email };
    });
  }
  async reconnect(id: string, subject: string | null) {
    await this.db.query(
      "UPDATE calendar_connections SET status='reconnect_needed' WHERE conversation_id=$1 AND ($2::text IS NULL OR subject=$2)",
      [id, subject],
    );
  }
}
