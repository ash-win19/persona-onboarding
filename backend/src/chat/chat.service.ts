import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { DATABASE, type Database } from './database.js';
import { OnboardingService } from './onboarding.js';
import { MODEL, type ReplyModel } from './model.js';
import { Authority, credentialHash, type Owner } from './authority.js';

export type Turn = {
  role: 'user' | 'assistant';
  content: string;
  id: string;
  submissionId: string;
  createdAt: Date;
};
type Operation = {
  id: string;
  content: string;
  status: 'generating' | 'completed' | 'failed';
  attempt: string;
  lease_until: Date;
  error_code: string | null;
};
@Injectable()
export class ChatService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MODEL) private readonly model: ReplyModel,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
    @Inject(Authority) private readonly authority: Authority,
  ) {}
  async create() {
    const credential = randomBytes(32).toString('base64url');
    await this.db.query(
      'INSERT INTO conversations(id, credential_hash) VALUES ($1, $2)',
      [randomUUID(), credentialHash(credential)],
    );
    return { credential, snapshot: await this.read(credential) };
  }
  async read(credential: string | undefined) {
    return this.db.transaction(async (sql) => {
      await sql.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const conversation = await this.authority.authorize(credential, sql);
      const result = await sql.query<Turn>(
        'SELECT id, role, content, channel, delivery, submission_id AS "submissionId", created_at AS "createdAt" FROM turns WHERE conversation_id = $1 ORDER BY sequence',
        [conversation.id],
      );
      const latest = await sql.query<Operation>(
        'SELECT * FROM submissions WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
        [conversation.id],
      );
      const operation = latest.rows[0];
      const interrupted =
        operation?.status === 'generating' &&
        new Date(operation.lease_until).getTime() <= Date.now();
      return {
        control: this.authority.view(conversation),
        onboarding: await this.onboarding.read(
          sql,
          conversation.id,
          conversation.revision,
        ),
        conversationId: conversation.id,
        revision: conversation.revision,
        turns: result.rows,
        operation: operation
          ? {
              id: operation.id,
              status: interrupted ? 'failed' : operation.status,
              errorCode: interrupted
                ? 'REPLY_INTERRUPTED'
                : operation.error_code,
            }
          : null,
      };
    });
  }
  async submit(
    credential: string | undefined,
    submissionId: string,
    content: string,
    owner?: Owner,
  ) {
    const conversation = await this.authority.authorize(credential);
    const attempt = randomUUID();
    const claimed = await this.db.transaction(async (sql) => {
      const controlled = await this.authority.authorize(credential, sql, true);
      this.authority.assertOwner(controlled, owner);
      const call = await sql.query(
        "SELECT id FROM calls WHERE conversation_id=$1 AND status IN ('connecting','active')",
        [conversation.id],
      );
      if (call.rows.length) throw new ConflictException('CALL_ACTIVE');
      const existing = (
        await sql.query<Operation>(
          'SELECT * FROM submissions WHERE conversation_id = $1 AND id = $2',
          [conversation.id, submissionId],
        )
      ).rows[0];
      if (existing && existing.content !== content)
        throw new ConflictException('SUBMISSION_CONFLICT');
      if (
        existing?.status === 'completed' ||
        (existing?.status === 'generating' &&
          new Date(existing.lease_until).getTime() > Date.now())
      )
        return false;
      const unresolved = await sql.query(
        'SELECT id FROM submissions WHERE conversation_id = $1 AND id <> $2 AND status <> $3 LIMIT 1',
        [conversation.id, submissionId, 'completed'],
      );
      if (unresolved.rows.length) throw new ConflictException('REPLY_PENDING');
      if (!existing) {
        await sql.query(
          'INSERT INTO turns(id, conversation_id, submission_id, role, content) VALUES ($1, $2, $3, $4, $5)',
          [randomUUID(), conversation.id, submissionId, 'user', content],
        );
        await sql.query(
          'UPDATE conversations SET revision = revision + 1 WHERE id = $1',
          [conversation.id],
        );
      }
      await sql.query(
        `INSERT INTO submissions(conversation_id, id, content, status, attempt, lease_until)
        VALUES ($1, $2, $3, 'generating', $4, now() + interval '90 seconds')
        ON CONFLICT(conversation_id, id) DO UPDATE SET status = 'generating', attempt = $4, lease_until = now() + interval '90 seconds', error_code = NULL`,
        [conversation.id, submissionId, content, attempt],
      );
      await sql.query(
        'UPDATE submissions SET owner_epoch=$3 WHERE conversation_id=$1 AND id=$2',
        [conversation.id, submissionId, controlled.owner_epoch],
      );
      return true;
    });
    if (!claimed) return this.read(credential);
    const snapshot = await this.read(credential);
    let reply: string;
    try {
      reply = await this.model.reply(
        snapshot.turns
          .slice(-40)
          .map(({ role, content: text }) => ({ role, content: text })),
        {
          state: snapshot.onboarding,
          capture: (command) =>
            this.onboarding.capture(
              { conversationId: conversation.id, submissionId, attempt },
              command,
            ),
        },
      );
    } catch {
      await this.db.query(
        "UPDATE submissions SET status = 'failed', error_code = 'REPLY_UNAVAILABLE' WHERE conversation_id = $1 AND id = $2 AND attempt = $3",
        [conversation.id, submissionId, attempt],
      );
      console.warn(JSON.stringify({ code: 'REPLY_UNAVAILABLE', submissionId }));
      return this.read(credential);
    }
    await this.db.transaction(async (sql) => {
      const current = await this.authority.authorize(credential, sql, true);
      if (
        owner &&
        (current.owner_tab !== owner.tabId ||
          current.owner_epoch !== owner.epoch)
      )
        return;
      if (!owner && current.owner_tab) return;
      const accepted = await sql.query(
        "UPDATE submissions SET status = 'completed', error_code = NULL WHERE conversation_id = $1 AND id = $2 AND attempt = $3 AND status = 'generating' RETURNING id",
        [conversation.id, submissionId, attempt],
      );
      if (!accepted.rows.length) return;
      await sql.query(
        'INSERT INTO turns(id, conversation_id, submission_id, role, content) VALUES ($1, $2, $3, $4, $5)',
        [randomUUID(), conversation.id, submissionId, 'assistant', reply],
      );
      await sql.query(
        'UPDATE conversations SET revision = revision + 1 WHERE id = $1',
        [conversation.id],
      );
    });
    return this.read(credential);
  }
  async ready() {
    await this.db.query('SELECT id FROM conversations LIMIT 1');
    return { ready: true };
  }
}
