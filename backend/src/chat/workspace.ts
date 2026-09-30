import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MeetingAssistant } from './meeting-assistant.js';
import { createHash, randomUUID } from 'node:crypto';
import { Authority, type Owner } from './authority.js';
import { DATABASE, type Database, type Sql } from './database.js';
import { DAILY_MODEL, type DailyModel } from './daily-model.js';
import { OnboardingService } from './onboarding.js';

type Entry = {
  id: string;
  content: string;
  reply: string | null;
  status: 'generating' | 'completed' | 'failed';
  lease_until: Date;
  attempt: string;
};

@Injectable()
export class Workspace {
  constructor(
    @Inject(MeetingAssistant)
    private readonly meetingAssistant: MeetingAssistant,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(Authority) private readonly authority: Authority,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
    @Inject(DAILY_MODEL) private readonly model: DailyModel,
  ) {}

  private async access(
    token: string | undefined,
    sql: Sql = this.db,
    owner?: Owner,
    write = false,
  ) {
    const root = await this.authority.authorize(token, sql, write);
    if (write) this.authority.assertOwner(root, owner);
    const entered = await sql.query(
      'SELECT id FROM conversations WHERE id=$1 AND dashboard_entered_at IS NOT NULL',
      [root.id],
    );
    if (!entered.rows.length)
      throw new ForbiddenException('DASHBOARD_REQUIRED');
    return root;
  }

  async read(token: string | undefined) {
    const root = await this.access(token);
    const priorities = await this.db.query<{
      id: string;
      title: string;
      completed: boolean;
    }>(
      'SELECT id,title,completed FROM priorities WHERE conversation_id=$1 ORDER BY created_at,id',
      [root.id],
    );
    const threads = await this.db.query<{ id: string; title: string }>(
      'SELECT id,title FROM daily_threads WHERE conversation_id=$1 ORDER BY updated_at DESC,id LIMIT 100',
      [root.id],
    );
    const onboardingTasks = await this.onboardingTasks(this.db, root);
    return {
      priorities: priorities.rows,
      threads: threads.rows,
      onboardingTasks,
    };
  }

  private async onboardingTasks(
    sql: Sql,
    root: { id: string; revision: number },
  ) {
    const state = await this.onboarding.read(sql, root.id, root.revision);
    const intake = state.intake;
    if (intake?.noTasks) return [];
    const tasks =
      intake?.tasks ??
      (state.facts.helpRequest.status === 'known' &&
      state.facts.helpRequest.value
        ? [state.facts.helpRequest.value]
        : []);
    const candidates = [
      ...tasks.map((title) => ({ title, source: 'request' as const })),
      ...(intake?.plan?.accepted
        ? intake.plan.steps.map((title) => ({ title, source: 'plan' as const }))
        : []),
    ];
    const checks = await sql.query<{ task_id: string; completed: boolean }>(
      'SELECT task_id,completed FROM onboarding_task_checks WHERE conversation_id=$1',
      [root.id],
    );
    const completed = new Map(
      checks.rows.map((row) => [row.task_id, row.completed]),
    );
    const seen = new Set<string>();
    return candidates.flatMap(({ title, source }) => {
      const normalized = title.trim().replace(/\s+/g, ' ').toLowerCase();
      if (!normalized || seen.has(normalized)) return [];
      seen.add(normalized);
      // Content-based identity preserves checks when a plan is reordered, but
      // does not mark a newly worded task complete by reusing its old position.
      const id = createHash('sha256')
        .update(`${root.id}\n${normalized}`)
        .digest('hex');
      return [
        {
          id,
          title: title.trim(),
          source,
          completed: completed.get(id) ?? false,
        },
      ];
    });
  }

  async completeOnboardingTask(
    token: string | undefined,
    id: string,
    completed: boolean,
    owner?: Owner,
  ) {
    await this.db.transaction(async (sql) => {
      const root = await this.access(token, sql, owner, true);
      const tasks = await this.onboardingTasks(sql, root);
      if (!tasks.some((task) => task.id === id)) throw new NotFoundException();
      await sql.query(
        `INSERT INTO onboarding_task_checks(conversation_id,task_id,completed) VALUES($1,$2,$3)
         ON CONFLICT(conversation_id,task_id) DO UPDATE SET completed=$3`,
        [root.id, id, completed],
      );
    });
    return this.read(token);
  }

  async priority(
    token: string | undefined,
    id: string,
    title: string,
    owner?: Owner,
  ) {
    await this.db.transaction(async (sql) => {
      const root = await this.access(token, sql, owner, true);
      const existing = await sql.query<{ title: string }>(
        'SELECT title FROM priorities WHERE id=$1 AND conversation_id=$2',
        [id, root.id],
      );
      if (existing.rows.length) {
        if (existing.rows[0].title !== title) throw new ConflictException();
        return;
      }
      const count = await sql.query<{ count: string }>(
        'SELECT count(*) FROM priorities WHERE conversation_id=$1',
        [root.id],
      );
      if (Number(count.rows[0].count) >= 500)
        throw new ConflictException('PRIORITY_LIMIT');
      const saved = await sql.query(
        'INSERT INTO priorities(id,conversation_id,title) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',
        [id, root.id, title],
      );
      if (!saved.rows.length) throw new ConflictException();
    });
    return this.read(token);
  }

  async complete(
    token: string | undefined,
    id: string,
    completed: boolean,
    owner?: Owner,
  ) {
    await this.db.transaction(async (sql) => {
      const root = await this.access(token, sql, owner, true);
      const saved = await sql.query(
        'UPDATE priorities SET completed=$3 WHERE id=$1 AND conversation_id=$2 RETURNING id',
        [id, root.id, completed],
      );
      if (!saved.rows.length) throw new NotFoundException();
    });
    return this.read(token);
  }

  private async thread(sql: Sql, root: string, id: string) {
    const result = await sql.query<{ id: string; title: string }>(
      'SELECT id,title FROM daily_threads WHERE id=$1 AND conversation_id=$2',
      [id, root],
    );
    if (!result.rows.length) throw new NotFoundException();
    const entries = await sql.query<Entry>(
      'SELECT id,content,reply,status,lease_until,attempt FROM daily_entries WHERE thread_id=$1 ORDER BY sequence',
      [id],
    );
    return {
      ...result.rows[0],
      entries: entries.rows.map(
        ({ id: entryId, content, reply, status, lease_until }) => ({
          id: entryId,
          content,
          reply,
          status:
            status === 'generating' &&
            new Date(lease_until).getTime() <= Date.now()
              ? ('failed' as const)
              : status,
        }),
      ),
    };
  }

  async readThread(token: string | undefined, id: string) {
    const root = await this.access(token);
    return this.thread(this.db, root.id, id);
  }

  async send(
    token: string | undefined,
    id: string,
    submissionId: string,
    content: string,
    owner?: Owner,
  ) {
    const attempt = randomUUID();
    const claimed = await this.db.transaction(async (sql) => {
      const root = await this.access(token, sql, owner, true);
      await sql.query(
        'INSERT INTO daily_threads(id,conversation_id,title) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [id, root.id, content.slice(0, 100)],
      );
      await this.thread(sql, root.id, id);
      const rows = await sql.query<Entry>(
        'SELECT * FROM daily_entries WHERE thread_id=$1 ORDER BY sequence',
        [id],
      );
      const existing = rows.rows.find((entry) => entry.id === submissionId);
      if (existing && existing.content !== content)
        throw new ConflictException('SUBMISSION_CONFLICT');
      if (
        existing?.status === 'completed' ||
        (existing?.status === 'generating' &&
          new Date(existing.lease_until).getTime() > Date.now())
      )
        return null;
      if (
        rows.rows.some(
          (entry) => entry.id !== submissionId && entry.status !== 'completed',
        )
      )
        throw new ConflictException('REPLY_PENDING');
      const saved = await sql.query(
        `INSERT INTO daily_entries(id,thread_id,content,status,attempt,lease_until) VALUES($1,$2,$3,'generating',$4,now()+interval '90 seconds')
        ON CONFLICT(id) DO UPDATE SET status='generating',attempt=$4,lease_until=now()+interval '90 seconds' WHERE daily_entries.thread_id=$2 RETURNING id`,
        [submissionId, id, content, attempt],
      );
      if (!saved.rows.length)
        throw new ConflictException('SUBMISSION_CONFLICT');
      await sql.query('UPDATE daily_threads SET updated_at=now() WHERE id=$1', [
        id,
      ]);
      return root;
    });
    if (!claimed) return this.readThread(token, id);
    try {
      const state = await this.onboarding.read(
        this.db,
        claimed.id,
        claimed.revision,
      );
      const thread = await this.thread(this.db, claimed.id, id);
      const meetingReply = await this.meetingAssistant.reply(
        {
          conversationId: claimed.id,
          threadId: id,
          sourceId: submissionId,
          attempt,
          owner,
        },
        thread.entries.flatMap((entry) => [
          { role: 'user' as const, content: entry.content },
          ...(entry.reply
            ? [{ role: 'assistant' as const, content: entry.reply }]
            : []),
        ]),
      );
      const reply =
        meetingReply ??
        (await this.model.reply(
          thread.entries.flatMap((entry) => [
            { role: 'user' as const, content: entry.content },
            ...(entry.reply
              ? [{ role: 'assistant' as const, content: entry.reply }]
              : []),
          ]),
          {
            userName: state.facts.userName.value,
            agentName: state.facts.agentName.value,
            firstTask: state.intake
              ? (state.intake.tasks[0] ?? null)
              : state.facts.helpRequest.value,
            tasks: state.intake?.tasks.join('\n') || null,
            starterPlan: state.intake?.plan?.accepted
              ? state.intake.plan.steps.join('\n')
              : null,
          },
        ));
      await this.db.transaction(async (sql) => {
        const current = await this.access(token, sql, owner, true);
        if (
          current.id !== claimed.id ||
          current.owner_epoch !== claimed.owner_epoch
        )
          throw new ForbiddenException();
        await sql.query(
          "UPDATE daily_entries SET reply=$4,status='completed' WHERE id=$1 AND thread_id=$2 AND attempt=$3 AND status='generating'",
          [submissionId, id, attempt, reply],
        );
      });
    } catch {
      await this.db.query(
        "UPDATE daily_entries SET status='failed' WHERE id=$1 AND thread_id=$2 AND attempt=$3 AND status='generating'",
        [submissionId, id, attempt],
      );
    }
    return this.readThread(token, id);
  }
}
