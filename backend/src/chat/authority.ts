import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DATABASE, type Database, type Sql } from './database.js';

export const CLOCK = Symbol('CLOCK');
export type Clock = () => number;
export type Owner = { tabId: string; epoch: number };
export type Conversation = Record<string, unknown> & {
  id: string;
  revision: number;
  owner_tab: string | null;
  owner_epoch: number;
  owner_until: Date | null;
};
export const credentialHash = (credential: string) =>
  createHash('sha256').update(credential).digest('hex');
export const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

@Injectable()
export class Authority {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) readonly now: Clock,
  ) {}

  async authorize(
    credential: string | undefined,
    sql: Sql = this.db,
    lock = false,
  ): Promise<Conversation> {
    if (!credential || !/^[A-Za-z0-9_-]{43}$/.test(credential))
      throw new UnauthorizedException();
    const result = await sql.query<Conversation>(
      `SELECT c.id, c.revision, c.owner_tab, c.owner_epoch, c.owner_until
       FROM account_sessions s JOIN accounts a ON a.id=s.account_id
       JOIN conversations c ON c.id=a.conversation_id
       WHERE s.token_hash=$1 AND s.expires_at>$2${lock ? ' FOR UPDATE OF c' : ''}`,
      [credentialHash(credential), new Date(this.now())],
    );
    if (!result.rows[0]) throw new UnauthorizedException();
    return result.rows[0];
  }

  assertOwner(conversation: Conversation, owner?: Owner) {
    // A previously deployed client can finish until the first tab claims control.
    if (!conversation.owner_tab && !owner) return;
    if (
      !owner ||
      owner.tabId !== conversation.owner_tab ||
      owner.epoch !== conversation.owner_epoch ||
      !conversation.owner_until ||
      new Date(conversation.owner_until).getTime() <= this.now()
    ) {
      throw new ForbiddenException('CONTROL_REQUIRED');
    }
  }

  view(conversation: Conversation) {
    return {
      tabId: conversation.owner_tab,
      epoch: conversation.owner_epoch,
      expiresAt: conversation.owner_until,
    };
  }

  async claim(
    credential: string | undefined,
    tabId: string,
    takeover: boolean,
  ) {
    return this.db.transaction(async (sql) => {
      const current = await this.authorize(credential, sql, true);
      const available =
        !current.owner_tab ||
        !current.owner_until ||
        new Date(current.owner_until).getTime() <= this.now();
      if (current.owner_tab !== tabId && !available && !takeover)
        return { control: this.view(current) };
      const epoch =
        current.owner_epoch +
        (current.owner_tab === tabId && !available ? 0 : 1);
      const expiresAt = new Date(this.now() + 15000);
      await sql.query(
        'UPDATE conversations SET owner_tab=$2, owner_epoch=$3, owner_until=$4 WHERE id=$1',
        [current.id, tabId, epoch, expiresAt],
      );
      if (epoch !== current.owner_epoch) {
        await sql.query(
          "UPDATE submissions SET status='failed', error_code='CONTROL_CHANGED' WHERE conversation_id=$1 AND status='generating'",
          [current.id],
        );
        await sql.query(
          "UPDATE calls SET status='ended', reason='takeover', ended_at=$2 WHERE conversation_id=$1 AND status IN ('connecting','active')",
          [current.id, new Date(this.now())],
        );
      }
      return { control: { tabId, epoch, expiresAt } };
    });
  }
}
