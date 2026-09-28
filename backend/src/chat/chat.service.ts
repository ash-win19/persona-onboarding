import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DATABASE, type Database, type Sql } from './database.js';
import { MODEL, type ReplyModel } from './model.js';

type Conversation = { id: string; revision: number };
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
const hash = (credential: string) =>
  createHash('sha256').update(credential).digest('hex');

@Injectable()
export class ChatService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MODEL) private readonly model: ReplyModel,
  ) {}
  async create() {
    const credential = randomBytes(32).toString('base64url');
    await this.db.query(
      'INSERT INTO conversations(id, credential_hash) VALUES ($1, $2)',
      [randomUUID(), hash(credential)],
    );
    return { credential, snapshot: await this.read(credential) };
  }
  private async authorize(
    credential: string | undefined,
    sql: Sql = this.db,
  ): Promise<Conversation> {
    if (!credential || !/^[A-Za-z0-9_-]{43}$/.test(credential))
      throw new UnauthorizedException();
    const result = await sql.query<Conversation>(
      'SELECT id, revision FROM conversations WHERE credential_hash = $1',
      [hash(credential)],
    );
    if (!result.rows[0]) throw new UnauthorizedException();
    return result.rows[0];
  }
  async read(credential: string | undefined) {
    return this.db.transaction(async (sql) => {
      await sql.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const conversation = await this.authorize(credential, sql);
      const result = await sql.query<Turn>(
        'SELECT id, role, content, submission_id AS "submissionId", created_at AS "createdAt" FROM turns WHERE conversation_id = $1 ORDER BY sequence',
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
  ) {
    const conversation = await this.authorize(credential);
    const attempt = randomUUID();
    const claimed = await this.db.transaction(async (sql) => {
      await sql.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [
        conversation.id,
      ]);
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
