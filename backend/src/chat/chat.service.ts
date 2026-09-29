import { Diagnostics } from './diagnostics.js';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { DATABASE, type Database, type Sql } from './database.js';
import { OnboardingPolicy } from './onboarding-policy.js';
import { OnboardingService } from './onboarding.js';
import { MODEL, type ReplyModel } from './model.js';
import { Authority, credentialHash, type Owner } from './authority.js';
import { saveOpening } from './opening.js';
import { readJourney, handoffMessage, skipMessage } from './journey.js';
import {
  CONVERSATION_MEMORY,
  memoryWindow,
  type ConversationMemory,
} from './memory.js';

export interface ReplyStream {
  start(snapshot: Awaited<ReturnType<ChatService['read']>>): void;
  delta(text: string): void;
}
export type Turn = {
  role: 'user' | 'assistant';
  content: string;
  delivery: string;
  id: string;
  submissionId: string;
  createdAt: Date;
  kind: 'opening' | 'message' | 'handoff';
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
    @Inject(Diagnostics) private readonly diagnostics: Diagnostics,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MODEL) private readonly model: ReplyModel,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
    @Inject(Authority) private readonly authority: Authority,
    @Inject(OnboardingPolicy) private readonly policy: OnboardingPolicy,
    @Inject(CONVERSATION_MEMORY) private readonly memory: ConversationMemory,
  ) {}
  async create(sql: Sql) {
    const id = randomUUID();
    await sql.query(
      'INSERT INTO conversations(id,credential_hash) VALUES($1,$2)',
      [id, credentialHash(randomBytes(32).toString('base64url'))],
    );
    await this.policy.activity(sql, id);
    await this.policy.offer(sql, id, 'agentName');
    await saveOpening(sql, id);
    return id;
  }
  async open(credential: string | undefined) {
    return this.db.transaction(async (sql) => {
      const conversation = await this.authority.authorize(
        credential,
        sql,
        true,
      );
      const claimed = await sql.query(
        `UPDATE conversations SET introduced_at=now() WHERE id=$1 AND introduced_at IS NULL
         AND EXISTS(SELECT 1 FROM turns WHERE conversation_id=$1 AND kind='opening')
         AND NOT EXISTS(SELECT 1 FROM turns WHERE conversation_id=$1 AND kind<>'opening') RETURNING id`,
        [conversation.id],
      );
      return {
        ...(await this.snapshot(credential, sql)),
        introduction: claimed.rows.length > 0,
      };
    });
  }
  async read(credential: string | undefined) {
    return this.db.transaction(async (sql) => {
      await sql.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      return this.snapshot(credential, sql);
    });
  }
  private async snapshot(credential: string | undefined, sql: Sql) {
    const conversation = await this.authority.authorize(credential, sql);
    const result = await sql.query<Turn>(
      'SELECT id, role, content, channel, delivery, kind, submission_id AS "submissionId", created_at AS "createdAt" FROM turns WHERE conversation_id = $1 ORDER BY sequence',
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
    const onboarding = await this.onboarding.read(
      sql,
      conversation.id,
      conversation.revision,
    );
    return {
      control: this.authority.view(conversation),
      onboarding,
      journey: await readJourney(sql, conversation.id, onboarding),
      conversationId: conversation.id,
      revision: conversation.revision,
      turns: result.rows,
      operation: operation
        ? {
            id: operation.id,
            status: interrupted ? 'failed' : operation.status,
            errorCode: interrupted ? 'REPLY_INTERRUPTED' : operation.error_code,
          }
        : null,
    };
  }
  async submit(
    credential: string | undefined,
    submissionId: string,
    content: string,
    owner?: Owner,
    stream?: ReplyStream,
  ) {
    const conversation = await this.authority.authorize(credential);
    const attempt = randomUUID();
    const claimed = await this.db.transaction(async (sql) => {
      const controlled = await this.authority.authorize(credential, sql, true);
      this.authority.assertOwner(controlled, owner);
      const opening = await sql.query(
        "SELECT id FROM turns WHERE conversation_id=$1 AND submission_id=$2 AND kind='opening'",
        [conversation.id, submissionId],
      );
      if (opening.rows.length)
        throw new ConflictException('SUBMISSION_CONFLICT');
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
        await this.policy.activity(sql, conversation.id);
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
    stream?.start(snapshot);
    const memory = await this.memory.context(conversation.id);
    let reply: string;
    try {
      reply = await this.model.reply(
        memoryWindow(
          snapshot.turns.filter(
            (turn) =>
              turn.role === 'user' ||
              ['text', 'played'].includes(turn.delivery),
          ),
          memory,
          { recent: 10, max: 40 },
        ).map(({ role, content: text }) => ({ role, content: text })),
        {
          state: snapshot.onboarding,
          memory,
          capture: (command) =>
            this.onboarding.capture(
              { conversationId: conversation.id, submissionId, attempt },
              command,
            ),
        },
        stream && ((text) => stream.delta(text)),
      );
    } catch {
      await this.db.query(
        "UPDATE submissions SET status = 'failed', error_code = 'REPLY_UNAVAILABLE' WHERE conversation_id = $1 AND id = $2 AND attempt = $3",
        [conversation.id, submissionId, attempt],
      );
      void this.diagnostics.record('REPLY_UNAVAILABLE', submissionId);
      return this.read(credential);
    }
    await this.db.transaction(async (sql) => {
      const current = await this.authority.authorize(credential, sql, true);
      if (
        owner &&
        (current.owner_tab !== owner.tabId ||
          current.owner_epoch !== owner.epoch ||
          !current.owner_until ||
          new Date(current.owner_until).getTime() <= this.authority.now())
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
      await this.onboarding.deliveredText(
        sql,
        conversation.id,
        submissionId,
        reply,
      );
      await sql.query(
        'UPDATE conversations SET revision = revision + 1 WHERE id = $1',
        [conversation.id],
      );
    });
    void this.memory.observe(conversation.id);
    return this.read(credential);
  }
  async ready() {
    await this.db.query('SELECT id FROM conversations LIMIT 1');
    return { ready: true };
  }

  async journey(
    credential: string | undefined,
    action: 'prepare' | 'skip' | 'enter',
    owner?: Owner,
  ) {
    await this.db.transaction(async (sql) => {
      const conversation = await this.authority.authorize(
        credential,
        sql,
        true,
      );
      this.authority.assertOwner(conversation, owner);
      const state = await this.onboarding.read(
        sql,
        conversation.id,
        conversation.revision,
      );
      const journey = await readJourney(sql, conversation.id, state);
      if (journey.entered) return;
      if (action !== 'skip' && !journey.ready)
        throw new ConflictException('ONBOARDING_NOT_READY');
      if (action === 'enter' && !journey.prepared)
        throw new ConflictException('HANDOFF_NOT_PREPARED');
      if (!journey.prepared) {
        const call = (
          await sql.query<{ id: string }>(
            "SELECT id FROM calls WHERE conversation_id=$1 AND status='active'",
            [conversation.id],
          )
        ).rows[0];
        const message = state.facts.helpRequest.value
          ? handoffMessage
          : skipMessage;
        await sql.query(
          `UPDATE conversations SET handoff_prepared_at=now(),graduated_at=COALESCE(graduated_at,now()),handoff_message=$2,handoff_delivery=$3,handoff_call_id=$4,revision=revision+1,onboarding_revision=revision+1 WHERE id=$1`,
          [
            conversation.id,
            message,
            call ? 'waiting' : 'text',
            call?.id ?? null,
          ],
        );
        await sql.query(
          "INSERT INTO turns(id,conversation_id,submission_id,role,content,kind) VALUES($1,$2,$3,'assistant',$4,'handoff')",
          [randomUUID(), conversation.id, randomUUID(), message],
        );
      }
      if (action === 'enter')
        await sql.query(
          'UPDATE conversations SET dashboard_entered_at=COALESCE(dashboard_entered_at,now()) WHERE id=$1',
          [conversation.id],
        );
    });
    return this.read(credential);
  }
}
