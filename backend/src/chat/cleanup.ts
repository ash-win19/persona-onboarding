import type { Database, Sql } from './database.js';
import { removeConversation } from './reset.js';
import { uuid } from './authority.js';
async function active(sql: Sql, id: string, now: Date) {
  return (
    (
      await sql.query<{ active: boolean }>(
        `SELECT owner_until>$2 OR EXISTS(SELECT 1 FROM calls WHERE conversation_id=$1 AND status IN ('connecting','active'))
    OR EXISTS(SELECT 1 FROM submissions WHERE conversation_id=$1 AND status='generating' AND lease_until>$2)
    OR EXISTS(SELECT 1 FROM gmail_attempts WHERE conversation_id=$1 AND status IN ('pending','exchanging') AND expires_at>$2) AS active FROM conversations WHERE id=$1`,
        [id, now],
      )
    ).rows[0]?.active ?? false
  );
}
export class Cleanup {
  constructor(
    private readonly db: Database,
    private readonly now = () => Date.now(),
  ) {}
  async preview(before: Date, limit = 100) {
    if (
      !Number.isFinite(before.getTime()) ||
      before.getTime() > this.now() ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error('INVALID_SELECTION');
    const rows = (
      await this.db.query<{
        id: string;
        last_activity: Date | null;
        created_at: Date;
      }>(
        'SELECT id,last_activity,created_at FROM conversations WHERE COALESCE(last_activity,created_at)<$1 ORDER BY created_at LIMIT $2',
        [before, limit],
      )
    ).rows;
    const selected: string[] = [],
      skipped: string[] = [];
    for (const row of rows)
      ((await active(this.db, row.id, new Date(this.now())))
        ? skipped
        : selected
      ).push(row.id);
    return {
      selected,
      skipped,
      counts: { selected: selected.length, skipped: skipped.length },
    };
  }
  async remove(ids: string[]) {
    if (ids.length > 100 || ids.some((id) => !uuid(id)))
      throw new Error('INVALID_SELECTION');
    const report = {
      selected: new Set(ids).size,
      skipped: 0,
      removed: 0,
      missing: 0,
      failed: 0,
    };
    for (const id of new Set(ids)) {
      try {
        const outcome = await this.db.transaction(async (sql) => {
          const row = await sql.query(
            'SELECT id FROM conversations WHERE id=$1 FOR UPDATE',
            [id],
          );
          if (!row.rows.length) return 'missing' as const;
          if (await active(sql, id, new Date(this.now())))
            return 'skipped' as const;
          await removeConversation(sql, id);
          return 'removed' as const;
        });
        report[outcome]++;
      } catch {
        report.failed++;
      }
    }
    return report;
  }
  async purgeDiagnostics() {
    const result = await this.db.query(
      'DELETE FROM operational_events WHERE at<$1 RETURNING id',
      [new Date(this.now() - 7 * 86400000)],
    );
    return { removed: result.rows.length };
  }
}
