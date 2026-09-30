import { sealGoogleToken, openGoogleToken } from './google-token-vault.js';
import { Diagnostics } from './diagnostics.js';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Authority, type Owner } from './authority.js';
import { DATABASE, type Database, type Sql } from './database.js';
import {
  GMAIL_PROVIDER,
  GMAIL_SCOPE,
  GmailAuthorizationError,
  type GmailProvider,
  type Tokens,
} from './gmail-provider.js';
import { OnboardingPolicy } from './onboarding-policy.js';

export const TOKEN_KEY = Symbol('TOKEN_KEY');
type Attempt = {
  id: string;
  conversation_id: string;
  generation: number;
  state_hash: string;
  verifier: string | null;
  status: string;
  expires_at: Date;
};
type Connection = {
  conversation_id: string;
  generation: number;
  email: string;
  tokens: string;
  expires_at: Date;
  checked_at: Date;
  status: string;
};
@Injectable()
export class Gmail {
  constructor(
    @Inject(Diagnostics) private readonly diagnostics: Diagnostics,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(Authority) private readonly authority: Authority,
    @Inject(GMAIL_PROVIDER) private readonly provider: GmailProvider,
    @Inject(TOKEN_KEY) private readonly key: string,
    @Inject(OnboardingPolicy) private readonly policy: OnboardingPolicy,
  ) {}
  private seal(value: unknown) {
    return sealGoogleToken(this.key, value);
  }
  private open<T>(value: string): T {
    return openGoogleToken<T>(this.key, value);
  }
  available() {
    return (
      this.provider.available() && Buffer.from(this.key, 'base64').length === 32
    );
  }
  async start(credential: string | undefined, owner: Owner) {
    if (!this.available()) throw new ConflictException('GMAIL_NOT_CONFIGURED');
    const id = randomUUID(),
      state = randomBytes(32).toString('base64url'),
      verifier = randomBytes(32).toString('base64url');
    await this.db.transaction(async (sql) => {
      const c = await this.authority.authorize(credential, sql, true);
      this.authority.assertOwner(c, owner);
      await this.policy.activity(sql, c.id);
      await this.policy.apply(sql, c.id, [
        {
          goal: 'gmail',
          outcome: 'open',
          evidence: 'Explicit connection button',
        },
      ]);
      const row = (
        await sql.query<{ gmail_generation: number }>(
          'UPDATE conversations SET gmail_generation=gmail_generation+1 WHERE id=$1 RETURNING gmail_generation',
          [c.id],
        )
      ).rows[0];
      await sql.query(
        "UPDATE gmail_attempts SET status='superseded',verifier=NULL WHERE conversation_id=$1 AND status IN ('pending','exchanging')",
        [c.id],
      );
      await sql.query(
        "INSERT INTO gmail_attempts(id,conversation_id,generation,state_hash,verifier,status,expires_at) VALUES($1,$2,$3,$4,$5,'pending',$6)",
        [
          id,
          c.id,
          row.gmail_generation,
          createHash('sha256').update(state).digest('hex'),
          this.seal(verifier),
          new Date(this.authority.now() + 600000),
        ],
      );
    });
    return {
      attemptId: id,
      url: this.provider.authorize(
        state,
        createHash('sha256').update(verifier).digest('base64url'),
      ),
    };
  }
  async cancel(credential: string | undefined, owner: Owner, id: string) {
    await this.db.transaction(async (sql) => {
      const c = await this.authority.authorize(credential, sql, true);
      this.authority.assertOwner(c, owner);
      await sql.query(
        "UPDATE gmail_attempts SET status='closed',verifier=NULL WHERE id=$1 AND conversation_id=$2 AND status='pending'",
        [id, c.id],
      );
    });
    return this.status(credential, false);
  }
  async callback(
    credential: string | undefined,
    state: string,
    code?: string,
    error?: string,
  ) {
    let attempt: Attempt | undefined;
    let result = 'invalid';
    await this.db.transaction(async (sql) => {
      const c = await this.authority.authorize(credential, sql, true);
      const row = (
        await sql.query<Attempt>(
          'SELECT * FROM gmail_attempts WHERE state_hash=$1 AND conversation_id=$2',
          [createHash('sha256').update(state).digest('hex'), c.id],
        )
      ).rows[0];
      if (!row) return;
      if (row.status !== 'pending') {
        result = row.status;
        return;
      }
      if (new Date(row.expires_at).getTime() <= this.authority.now()) {
        await sql.query(
          "UPDATE gmail_attempts SET status='expired',verifier=NULL WHERE id=$1",
          [row.id],
        );
        result = 'expired';
        return;
      }
      if (error || !code) {
        result = error === 'access_denied' ? 'denied' : 'failed';
        await sql.query(
          'UPDATE gmail_attempts SET status=$2,verifier=NULL WHERE id=$1',
          [row.id, result],
        );
        return;
      }
      await sql.query(
        "UPDATE gmail_attempts SET status='exchanging' WHERE id=$1",
        [row.id],
      );
      attempt = row;
    });
    if (!attempt) return result;
    const current = attempt;
    try {
      const tokens = await this.provider.exchange(
        code!,
        this.open<string>(current.verifier!),
      );
      if (
        !tokens.scope.split(' ').includes(GMAIL_SCOPE) ||
        !tokens.refreshToken
      )
        throw new GmailAuthorizationError('GRANT_INCOMPLETE');
      const email = await this.provider.profile(tokens.accessToken);
      const encrypted = this.seal(tokens);
      result = await this.db.transaction(async (sql) => {
        const c = (
          await sql.query<{ gmail_generation: number }>(
            'SELECT gmail_generation FROM conversations WHERE id=$1 FOR UPDATE',
            [current.conversation_id],
          )
        ).rows[0];
        if (!c || c.gmail_generation !== current.generation)
          return 'superseded';
        const accepted = await sql.query(
          "UPDATE gmail_attempts SET status='connected',verifier=NULL WHERE id=$1 AND status='exchanging' RETURNING id",
          [current.id],
        );
        if (!accepted.rows.length) return 'superseded';
        await sql.query(
          `INSERT INTO gmail_connections(conversation_id,generation,email,tokens,expires_at,checked_at,status) VALUES($1,$2,$3,$4,$5,$6,'connected')
          ON CONFLICT(conversation_id) DO UPDATE SET generation=$2,email=$3,tokens=$4,expires_at=$5,checked_at=$6,status='connected'`,
          [
            current.conversation_id,
            current.generation,
            email,
            encrypted,
            new Date(tokens.expiresAt),
            new Date(this.authority.now()),
          ],
        );
        await sql.query(
          'UPDATE conversations SET gmail_verified_at=$2,revision=revision+1 WHERE id=$1',
          [current.conversation_id, new Date(this.authority.now())],
        );
        await sql.query(
          "INSERT INTO turns(id,conversation_id,submission_id,role,content) VALUES($1,$2,$3,'assistant',$4)",
          [
            randomUUID(),
            current.conversation_id,
            current.id,
            `Gmail is connected for ${email}. This trial has verified your account address; it does not read your messages.`,
          ],
        );
        return 'connected';
      });
    } catch {
      await this.db.query(
        "UPDATE gmail_attempts SET status='failed',verifier=NULL WHERE id=$1 AND status='exchanging'",
        [current.id],
      );
      result = 'failed';
    }
    void this.diagnostics.record(
      result === 'connected' ? 'GMAIL_CONNECTED' : 'GMAIL_FAILED',
      current.id,
    );
    return result;
  }
  private async connection(sql: Sql, id: string) {
    return (
      await sql.query<Connection>(
        'SELECT * FROM gmail_connections WHERE conversation_id=$1',
        [id],
      )
    ).rows[0];
  }
  async status(credential: string | undefined, verify = true) {
    const c = await this.authority.authorize(credential);
    await this.db.query(
      "UPDATE gmail_attempts SET status='expired',verifier=NULL WHERE conversation_id=$1 AND status IN ('pending','exchanging') AND expires_at<=$2",
      [c.id, new Date(this.authority.now())],
    );
    let connection = await this.connection(this.db, c.id);
    let unavailable = false;
    if (
      verify &&
      connection?.status === 'connected' &&
      (this.authority.now() - new Date(connection.checked_at).getTime() >
        300000 ||
        new Date(connection.expires_at).getTime() <= this.authority.now())
    ) {
      const generation = connection.generation;
      try {
        let tokens = this.open<Tokens>(connection.tokens);
        if (tokens.expiresAt <= this.authority.now() + 60000) {
          if (!tokens.refreshToken)
            throw new GmailAuthorizationError('REFRESH_MISSING');
          const refreshed = await this.provider.refresh(tokens.refreshToken);
          tokens = {
            ...refreshed,
            refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
          };
        }
        await this.provider.profile(tokens.accessToken);
        await this.db.query(
          "UPDATE gmail_connections SET tokens=$3,expires_at=$4,checked_at=$5 WHERE conversation_id=$1 AND generation=$2 AND status='connected'",
          [
            c.id,
            generation,
            this.seal(tokens),
            new Date(tokens.expiresAt),
            new Date(this.authority.now()),
          ],
        );
      } catch (e) {
        if (e instanceof GmailAuthorizationError) {
          await this.db.transaction(async (sql) => {
            await sql.query(
              'SELECT id FROM conversations WHERE id=$1 FOR UPDATE',
              [c.id],
            );
            const invalid = await sql.query(
              "UPDATE gmail_connections SET tokens='',status='reconnect_needed' WHERE conversation_id=$1 AND generation=$2 AND status='connected' RETURNING conversation_id",
              [c.id, generation],
            );
            if (invalid.rows.length)
              await sql.query(
                'UPDATE conversations SET gmail_verified_at=NULL,revision=revision+1 WHERE id=$1',
                [c.id],
              );
          });
        } else unavailable = true;
      }
      connection = await this.connection(this.db, c.id);
    }
    const attempt = (
      await this.db.query<{ id: string; status: string; expires_at: Date }>(
        'SELECT id,status,expires_at FROM gmail_attempts WHERE conversation_id=$1 ORDER BY generation DESC LIMIT 1',
        [c.id],
      )
    ).rows[0];
    return {
      available: this.available(),
      status: connection?.status ?? 'not_connected',
      email: connection?.email ?? null,
      unavailable,
      attempt: attempt
        ? {
            id: attempt.id,
            status: attempt.status,
            expiresAt: attempt.expires_at,
          }
        : null,
    };
  }
}
