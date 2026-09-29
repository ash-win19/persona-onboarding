import { Diagnostics } from './diagnostics.js';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { Authority, credentialHash, type Owner } from './authority.js';
import { DATABASE, type Database, type Sql } from './database.js';
import { ChatService } from './chat.service.js';
import { OnboardingPolicy } from './onboarding-policy.js';
import { Calls } from './calls.js';

export async function removeConversation(sql: Sql, id: string) {
  const calls = (
    await sql.query<{ id: string }>(
      'SELECT id FROM calls WHERE conversation_id=$1',
      [id],
    )
  ).rows.map((c) => c.id);
  await sql.query('DELETE FROM conversations WHERE id=$1', [id]);
  return calls;
}
@Injectable()
export class Reset {
  constructor(
    @Inject(Diagnostics) private readonly diagnostics: Diagnostics,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(Authority) private readonly authority: Authority,
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(OnboardingPolicy) private readonly policy: OnboardingPolicy,
    @Inject(Calls) private readonly calls: Calls,
  ) {}
  async start(
    credential: string | undefined,
    owner: Owner,
    operationId: string,
  ) {
    if (!credential || !/^[A-Za-z0-9_-]{43}$/.test(credential))
      throw new UnauthorizedException();
    const oldHash = credentialHash(credential);
    let callIds: string[] = [];
    const next = await this.db.transaction(async (sql) => {
      // Serialize retries even when the first request has already deleted the old row.
      await sql.query('SELECT pg_advisory_xact_lock(hashtext($1))', [oldHash]);
      const receipt = (
        await sql.query<{
          old_hash: string;
          new_hash: string;
          operation_id: string;
        }>(
          'SELECT old_hash,new_hash,operation_id FROM reset_receipts WHERE operation_id=$1 AND (old_hash=$2 OR new_hash=$2)',
          [operationId, oldHash],
        )
      ).rows[0];
      if (receipt)
        return receipt.new_hash === oldHash
          ? credential
          : createHmac('sha256', credential)
              .update('persona-reset:' + operationId)
              .digest('base64url');
      const current = await this.authority.authorize(credential, sql, true);
      this.authority.assertOwner(current, owner);
      const account = (
        await sql.query<{ id: string }>(
          'SELECT id FROM accounts WHERE conversation_id=$1',
          [current.id],
        )
      ).rows[0];
      const newCredential = createHmac('sha256', credential)
          .update('persona-reset:' + operationId)
          .digest('base64url'),
        id = randomUUID();
      callIds = await removeConversation(sql, current.id);
      await sql.query(
        'INSERT INTO conversations(id,credential_hash,owner_tab,owner_epoch,owner_until) VALUES($1,$2,$3,$4,$5)',
        [
          id,
          credentialHash(newCredential),
          owner.tabId,
          owner.epoch + 1,
          new Date(this.authority.now() + 15000),
        ],
      );
      await this.policy.activity(sql, id);
      await this.policy.offer(sql, id, 'agentName');
      await sql.query('UPDATE accounts SET conversation_id=$2 WHERE id=$1', [
        account.id,
        id,
      ]);
      await sql.query(
        'UPDATE account_sessions SET token_hash=$2 WHERE token_hash=$1',
        [oldHash, credentialHash(newCredential)],
      );
      await sql.query(
        'INSERT INTO reset_receipts(old_hash,new_hash,operation_id,new_conversation_id) VALUES($1,$2,$3,$4)',
        [oldHash, credentialHash(newCredential), operationId, id],
      );
      return newCredential;
    });
    await this.calls.closeDeleted(callIds);
    const snapshot = await this.chat.read(next);
    void this.diagnostics.record('SESSION_RESET', snapshot.conversationId);
    return { credential: next, snapshot };
  }
}
