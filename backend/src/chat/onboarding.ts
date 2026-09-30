import { Gmail } from './gmail.js';
import { Calendar } from './calendar.js';
import type { MemoryContext } from './memory.js';
import { Authority } from './authority.js';
import { Inject, Injectable } from '@nestjs/common';
import {
  emptyIntake,
  intakeInputSchema,
  planFor,
  updateIntake,
  type Intake,
} from './starter-plan.js';
import {
  OnboardingPolicy,
  policyGoals,
  type Preference,
  type PolicyState,
  type PolicyGoal,
} from './onboarding-policy.js';
import { randomUUID } from 'node:crypto';
import { DATABASE, type Database, type Sql } from './database.js';
import {
  CONVERSATION_MEMORY,
  noteKinds,
  type ConversationMemory,
  type MemoryNote,
} from './memory.js';

export const goals = ['agentName', 'userName', 'helpRequest'] as const;
export type Goal = (typeof goals)[number];
type Fact = {
  value: string | null;
  status: 'missing' | 'known' | 'ambiguous';
  sourceTurnId: string | null;
  revision: number | null;
};
export type OnboardingState = {
  intake?: Intake & { ready: boolean };
  revision: number;
  policy?: PolicyState;
  facts: Record<Goal, Fact>;
  gmail: 'connected' | 'not_connected';
  gmailAvailable?: boolean;
  // Calendar is required to finish only when the server can connect it.
  calendar?: 'connected' | 'not_connected';
  calendarAvailable?: boolean;
  call: 'successful' | 'not_started';
  graduated: boolean;
  onboardingComplete: boolean;
  mode: 'helping' | 'onboarding';
  missingGoals: string[];
};
export type CaptureResult = {
  ok: boolean;
  code: 'committed' | 'already_applied' | 'invalid' | 'stale' | 'pending';
  state: OnboardingState;
  // The setup step the guide should work toward next, if any.
  permittedGoal?: PolicyGoal | null;
  // The user asked to skip setup, which cannot be skipped.
  exitRequested?: boolean;
  // A lenient capture dropped details the user's words did not support.
  unverified?: boolean;
  source?: { turnId: string; text: string };
  sources?: { turnId: string; text: string }[];
  remembered?: MemoryNote[];
};
export interface OnboardingTools {
  state: OnboardingState;
  memory?: MemoryContext | null;
  capture(command: unknown): Promise<CaptureResult>;
  // Run the explicit task only after the user's onboarding facts are saved.
  replyToTask?(): Promise<string | null>;
}
// Only the authenticated coordinator supplies this context, never model arguments.
export type FactContext = { conversationId: string } & (
  | {
      submissionId: string;
      attempt: string;
      callId?: never;
      generation?: never;
      sourceItem?: never;
    }
  | {
      callId: string;
      generation: number;
      sourceItem: string;
      submissionId?: never;
      attempt?: never;
    }
);

type Change = {
  goal: Goal;
  action: 'set' | 'correct' | 'clarify';
  value: string | null;
  evidence: string;
};
type Command = {
  expectedRevision: number;
  askOnboarding: boolean;
  changes: Change[];
  preferences?: Preference[];
  exitEvidence?: string | null;
};
type Event = Record<string, unknown> & {
  goal: Goal;
  value: string | null;
  status: 'known' | 'ambiguous';
  sourceTurnId: string;
  revision: number;
};

// Saved as the handoff message, and used as the closing line when onboarding
// finishes outside a reply, such as returning from Google consent.
export function closingMessage(state: OnboardingState) {
  const name = state.facts.userName.value;
  const greeting = `You're all set${name ? `, ${name}` : ''}!`;
  return state.intake?.noTasks
    ? `${greeting} I'm here whenever something comes up.`
    : `${greeting} Let's head in and get started.`;
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => key in value);
const normalized = (value: string) =>
  value.normalize('NFKC').toLocaleLowerCase();

// Speech transcription may choose different sentence punctuation than the
// realtime model. Match contiguous words, retaining the canonical source span.
function spokenQuote(source: string, quote: string): string | undefined {
  const tokens = (text: string) => [
    ...text.matchAll(/[^\s.,!?;:\u201c\u201d"()]+/gu),
  ];
  const haystack = tokens(source),
    needle = tokens(quote);
  if (!needle.length) return;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (
      needle.every(
        (token, offset) =>
          normalized(token[0]) === normalized(haystack[i + offset][0]),
      )
    ) {
      const last = haystack[i + needle.length - 1];
      return source.slice(haystack[i].index, last.index + last[0].length);
    }
  }
}
// Spoken names are often spelled out: "Atom, A-T-O-M". Accept a name whose
// letters match a spelled-out run in the evidence. The run itself is not a
// usable name, so keep the proposed spelling, capitalized if it was shouted.
function spelledName(evidence: string, value: string): string | undefined {
  const letters = (text: string) =>
    text.replace(/[^\p{L}]/gu, '').toLocaleLowerCase();
  const wanted = letters(value);
  if (wanted.length < 2) return;
  for (const run of evidence.matchAll(
    /(?<!\p{L})\p{L}(?:[\s.-]+\p{L}(?!\p{L}))+/gu,
  ))
    if (letters(run[0]) === wanted)
      return value === value.toLocaleUpperCase()
        ? value.charAt(0) + value.slice(1).toLocaleLowerCase()
        : value;
}

function validCommand(value: unknown): value is Command {
  if (object(value) && 'exitEvidence' in value) {
    const { exitEvidence, ...rest } = value;
    return (
      (exitEvidence === null ||
        (typeof exitEvidence === 'string' &&
          exitEvidence.trim().length > 0 &&
          exitEvidence.length <= 8000)) &&
      validCommand(rest)
    );
  }
  if (
    !object(value) ||
    !(
      exactKeys(value, ['expectedRevision', 'askOnboarding', 'changes']) ||
      exactKeys(value, [
        'expectedRevision',
        'askOnboarding',
        'changes',
        'preferences',
      ])
    ) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    Number(value.expectedRevision) < 0 ||
    typeof value.askOnboarding !== 'boolean' ||
    !Array.isArray(value.changes) ||
    value.changes.length > 3
  )
    return false;
  if (
    value.preferences !== undefined &&
    (!Array.isArray(value.preferences) ||
      value.preferences.length > 5 ||
      !value.preferences.every(
        (p) =>
          object(p) &&
          exactKeys(p, ['goal', 'outcome', 'evidence']) &&
          policyGoals.includes(p.goal as never) &&
          ['declined', 'deferred', 'open'].includes(String(p.outcome)) &&
          typeof p.evidence === 'string' &&
          p.evidence.trim().length > 0 &&
          p.evidence.length <= 8000,
      ))
  )
    return false;
  const seen = new Set<string>();
  return value.changes.every((change: unknown) => {
    if (
      !object(change) ||
      !exactKeys(change, ['goal', 'action', 'value', 'evidence']) ||
      !goals.some((goal) => goal === change.goal) ||
      typeof change.goal !== 'string' ||
      seen.has(change.goal) ||
      !['set', 'correct', 'clarify'].includes(String(change.action)) ||
      typeof change.evidence !== 'string' ||
      !change.evidence.trim() ||
      change.evidence.length > 8000
    )
      return false;
    seen.add(change.goal);
    return change.action === 'clarify'
      ? change.value === null
      : typeof change.value === 'string' &&
          change.value.trim().length > 0 &&
          change.value.length <= (change.goal === 'helpRequest' ? 2000 : 100);
  });
}

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OnboardingPolicy) private readonly policy: OnboardingPolicy,
    @Inject(Authority) private readonly authority: Authority,
    @Inject(Gmail) private readonly gmail: Gmail,
    @Inject(Calendar) private readonly calendar: Calendar,
    @Inject(CONVERSATION_MEMORY) private readonly memory: ConversationMemory,
  ) {}

  async read(
    sql: Sql,
    conversationId: string,
    revision: number,
  ): Promise<OnboardingState> {
    const latest = await sql.query<Event>(
      `SELECT DISTINCT ON (goal) goal, value, status, source_turn_id AS "sourceTurnId", revision
      FROM onboarding_facts WHERE conversation_id = $1 ORDER BY goal, revision DESC`,
      [conversationId],
    );
    const accepted = await sql.query<Event>(
      `SELECT DISTINCT ON (goal) goal, value, status, source_turn_id AS "sourceTurnId", revision
      FROM onboarding_facts WHERE conversation_id = $1 AND status = 'known' ORDER BY goal, revision DESC`,
      [conversationId],
    );
    const facts = {} as Record<Goal, Fact>;
    for (const goal of goals) {
      const current = latest.rows.find((row) => row.goal === goal);
      const known = accepted.rows.find((row) => row.goal === goal);
      facts[goal] = {
        value: known?.value ?? null,
        status: current?.status ?? 'missing',
        sourceTurnId: known?.sourceTurnId ?? null,
        revision: known?.revision ?? null,
      };
    }
    const integration = (
      await sql.query<{
        gmail_verified_at: Date | null;
        call_successful_at: Date | null;
        call_active: boolean;
        call_attempted: boolean;
        gmail_pending: boolean;
        calendar_connected: boolean;
        calendar_pending: boolean;
        graduated_at: Date | null;
        onboarding_intake: Intake | null;
      }>(
        `SELECT gmail_verified_at,call_successful_at,graduated_at,onboarding_intake,
          EXISTS(SELECT 1 FROM calls WHERE conversation_id=$1 AND status IN ('connecting','active')) AS call_active,
          EXISTS(SELECT 1 FROM calls WHERE conversation_id=$1) AS call_attempted,
          EXISTS(SELECT 1 FROM gmail_attempts WHERE conversation_id=$1 AND status IN ('pending','exchanging') AND expires_at>$2) AS gmail_pending,
          EXISTS(SELECT 1 FROM calendar_connections WHERE conversation_id=$1 AND status='connected') AS calendar_connected,
          EXISTS(SELECT 1 FROM calendar_attempts WHERE conversation_id=$1 AND status IN ('pending','exchanging') AND expires_at>$2) AS calendar_pending
          FROM conversations WHERE id=$1`,
        [conversationId, new Date(this.authority.now())],
      )
    ).rows[0];
    const gmail = integration.gmail_verified_at ? 'connected' : 'not_connected';
    const calendarAvailable = this.calendar.available();
    const calendar = integration.calendar_connected
      ? 'connected'
      : 'not_connected';
    const google =
      gmail === 'connected' && (!calendarAvailable || calendar === 'connected');
    const graduated = !!integration.graduated_at;
    const intake = integration.onboarding_intake ?? emptyIntake();
    if (
      !intake.tasks.length &&
      !intake.noTasks &&
      facts.helpRequest.status === 'known'
    )
      intake.tasks = [facts.helpRequest.value!];
    const ready =
      facts.agentName.status === 'known' &&
      facts.userName.status === 'known' &&
      google &&
      (intake.tasks.length > 0 || intake.noTasks);
    const policy = await this.policy.read(sql, conversationId);
    for (const goal of goals)
      if (facts[goal].status === 'known') policy.goals[goal].eligible = false;
    if (
      integration.call_active ||
      integration.call_successful_at ||
      integration.call_attempted
    )
      policy.goals.voice.eligible = false;
    // The gmail goal is the Google step: Gmail, plus Calendar when available.
    if (
      google ||
      integration.gmail_pending ||
      integration.calendar_pending ||
      !this.gmail.available()
    )
      policy.goals.gmail.eligible = false;
    return {
      intake: { ...intake, ready },
      revision,
      policy,
      facts,
      gmail,
      gmailAvailable: this.gmail.available(),
      calendar,
      calendarAvailable,
      call: integration.call_successful_at ? 'successful' : 'not_started',
      graduated,
      onboardingComplete:
        !!intake.plan?.accepted ||
        (graduated &&
          !integration.onboarding_intake &&
          goals.every((goal) => facts[goal].status === 'known') &&
          gmail === 'connected'),
      mode: graduated ? 'helping' : 'onboarding',
      missingGoals: [
        ...goals.filter(
          (goal) =>
            facts[goal].status !== 'known' &&
            !(
              goal === 'helpRequest' &&
              (intake.noTasks || intake.tasks.length > 0)
            ),
        ),
        ...(gmail === 'not_connected' ? ['gmail'] : []),
        ...(calendarAvailable && calendar === 'not_connected'
          ? ['calendar']
          : []),
      ],
    };
  }

  async callOpening(sql: Sql, id: string, revision: number, callId: string) {
    await this.advance(sql, id, true);
    const current = (
      await sql.query<{ revision: number }>(
        'SELECT revision FROM conversations WHERE id=$1',
        [id],
      )
    ).rows[0];
    const state = await this.read(sql, id, current?.revision ?? revision);
    if (state.graduated)
      return {
        goal: null,
        direction: (
          state.intake
            ? state.intake.tasks.length
            : state.facts.helpRequest.value
        )
          ? 'Continue the saved first task with a concrete useful next step. Do not restart onboarding.'
          : 'Briefly greet the user and say you are ready whenever they want help. Do not ask setup questions.',
      };
    const goal = this.nextGoal(state, true);
    await sql.query(
      'UPDATE calls SET opening_goal=$2,opening_visit=$3 WHERE id=$1',
      [callId, goal, state.policy!.visitId],
    );
    return {
      goal,
      direction: goal
        ? 'Say a quick, warm hello (you are picking up the same conversation by voice), then continue with the next step.'
        : 'Say a quick, warm hello and let them know you are here when they are ready.',
    };
  }

  // The setup step the guide should work toward next. Steps the user declined,
  // or deferred during this visit, wait until they bring them up again.
  private nextGoal(
    state: OnboardingState,
    ask: boolean,
    reopened: PolicyGoal[] = [],
  ): PolicyGoal | null {
    if (!ask) return null;
    const candidates: PolicyGoal[] = [
      ...goals.filter((g) => state.facts[g].status === 'ambiguous'),
      'agentName',
      'userName',
      'gmail',
      'helpRequest',
    ];
    for (const goal of candidates) {
      if (
        goal === 'helpRequest' &&
        (state.intake?.tasks.length || state.intake?.noTasks)
      )
        continue;
      if (state.graduated && !reopened.includes(goal)) continue;
      if (!state.policy?.goals[goal].eligible) continue;
      return goal;
    }
    return null;
  }

  // Invitations never complete intake. Kept for delivery callers during rollout.
  async advance(_sql: Sql, _id: string, _voice = false): Promise<boolean> {
    return false;
  }

  // Graduates once every setup item is in. Returns the closing message, or
  // null when onboarding is not ready, already finished, or new input is still
  // being interpreted.
  async finish(
    sql: Sql,
    id: string,
    capturedSubmission?: string,
  ): Promise<string | null> {
    const row = (
      await sql.query<{ revision: number }>(
        'SELECT revision FROM conversations WHERE id=$1 FOR UPDATE',
        [id],
      )
    ).rows[0];
    const state = await this.read(sql, id, row.revision);
    if (state.graduated || !state.intake?.ready) return null;
    const pending = await sql.query(
      `SELECT 1 FROM submissions WHERE conversation_id=$1 AND status='generating'
      AND id<>COALESCE($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
      UNION ALL SELECT 1 FROM voice_items v JOIN calls c ON c.id=v.call_id
      WHERE c.conversation_id=$1 AND c.status='active' AND v.item_id=c.source_item_id
      AND v.submission_id<>COALESCE($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
      AND (NOT v.finalized OR NOT EXISTS(SELECT 1 FROM onboarding_assessments a WHERE a.conversation_id=$1 AND a.submission_id=v.submission_id)) LIMIT 1`,
      [id, capturedSubmission ?? null],
    );
    if (pending.rows.length) return null;
    const { ready: _ready, ...intake } = state.intake;
    const plan = intake.plan ?? planFor(intake);
    if (plan) intake.plan = { ...plan, presented: true, accepted: true };
    const message = closingMessage(state);
    await sql.query(
      `UPDATE conversations SET onboarding_intake=$2,graduated_at=COALESCE(graduated_at,now()),
      dashboard_entered_at=COALESCE(dashboard_entered_at,now()),handoff_prepared_at=COALESCE(handoff_prepared_at,now()),
      handoff_message=$3,handoff_delivery='text',revision=revision+1,onboarding_revision=revision+1 WHERE id=$1`,
      [id, JSON.stringify(intake), message],
    );
    return message;
  }

  async deliveredText(
    sql: Sql,
    id: string,
    submissionId: string,
    reply: string,
  ) {
    const receipt = (
      await sql.query<{ permitted_goal: PolicyGoal | null; visit_id: string }>(
        `SELECT permitted_goal,visit_id FROM onboarding_assessments
       WHERE conversation_id=$1 AND submission_id=$2 AND NOT delivered`,
        [id, submissionId],
      )
    ).rows[0];
    if (
      receipt?.permitted_goal &&
      (/[?？]/u.test(reply) || receipt.permitted_goal === 'gmail')
    ) {
      await this.policy.offer(
        sql,
        id,
        receipt.permitted_goal,
        receipt.visit_id,
      );
      await sql.query(
        `UPDATE onboarding_assessments SET delivered=true
        WHERE conversation_id=$1 AND submission_id=$2`,
        [id, submissionId],
      );
    }
    await this.advance(sql, id);
  }

  async deliveredVoice(sql: Sql, id: string, callId: string): Promise<boolean> {
    const delivered = await sql.query<{
      response_id: string;
      onboarding_goal: PolicyGoal;
      onboarding_visit: string;
    }>(
      `UPDATE voice_responses r SET invitation_delivered=true
       WHERE call_id=$1 AND (played OR text_delivered) AND NOT interrupted AND NOT invitation_delivered
       AND onboarding_goal IS NOT NULL
       AND EXISTS(SELECT 1 FROM turns t JOIN voice_items v ON v.turn_id=t.id
         WHERE v.call_id=r.call_id AND v.response_id=r.response_id AND NOT v.interrupted
         AND t.delivery IN ('text','played') AND length(t.content)>0)
       RETURNING response_id,onboarding_goal,onboarding_visit`,
      [callId],
    );
    for (const invitation of delivered.rows)
      await this.policy.offer(
        sql,
        id,
        invitation.onboarding_goal,
        invitation.onboarding_visit,
      );
    return delivered.rows.length ? this.advance(sql, id, true) : false;
  }

  // Lenient captures come from the server's own interpreter. They keep the
  // details the user's words support and drop the rest, so one unverifiable
  // item does not lose the whole turn. Strict captures (the realtime model's
  // tool calls) reject instead, which triggers their repair.
  async capture(
    context: FactContext,
    input: unknown,
    { lenient = false }: { lenient?: boolean } = {},
  ): Promise<CaptureResult> {
    // Working memory is optional and never invalidates an otherwise valid capture.
    const {
      memory,
      intake: intakeInput,
      ...command
    }: Record<string, unknown> = object(input) ? input : {};
    let notes: MemoryNote[] = [];
    const result = await this.db.transaction<CaptureResult>(async (sql) => {
      const conversation = (
        await sql.query<{ revision: number; onboarding_revision: number }>(
          'SELECT revision, onboarding_revision FROM conversations WHERE id = $1 FOR UPDATE',
          [context.conversationId],
        )
      ).rows[0];
      if (!conversation) throw new Error('CONVERSATION_UNAVAILABLE');
      let state = await this.read(
        sql,
        context.conversationId,
        conversation.revision,
      );
      const reject = (
        code: 'invalid' | 'stale' | 'pending',
      ): CaptureResult => ({
        ok: false,
        code,
        state,
        ...(source
          ? { source: { turnId: source.id, text: source.content } }
          : {}),
        ...(sources.length
          ? { sources: sources.map((s) => ({ turnId: s.id, text: s.content })) }
          : {}),
      });
      type Source = { id: string; content: string; submission_id?: string };
      let sources: Source[] = [];
      let source: Source | undefined;
      if (!context.callId)
        source = (
          await sql.query<{ id: string; content: string }>(
            `SELECT t.id, t.content FROM turns t JOIN submissions s
        ON s.conversation_id = t.conversation_id AND s.id = t.submission_id
        WHERE t.conversation_id = $1 AND t.submission_id = $2 AND t.role = 'user'
        AND s.attempt = $3 AND s.status = 'generating' AND s.lease_until > now()
        AND s.owner_epoch = (SELECT owner_epoch FROM conversations WHERE id = $1)
        AND EXISTS(SELECT 1 FROM conversations WHERE id=$1 AND (owner_tab IS NULL OR owner_until>$4))`,
            [
              context.conversationId,
              context.submissionId,
              context.attempt,
              new Date(this.authority.now()),
            ],
          )
        ).rows[0];
      else {
        const current = (
          await sql.query<{ id: string }>(
            "SELECT id FROM calls WHERE id=$1 AND conversation_id=$2 AND generation=$3 AND source_item_id=$4 AND status='active' AND deadline>$5 AND owner_epoch=(SELECT owner_epoch FROM conversations WHERE id=$2 AND owner_until>$5)",
            [
              context.callId,
              context.conversationId,
              context.generation,
              context.sourceItem,
              new Date(this.authority.now()),
            ],
          )
        ).rows[0];
        if (!current) return reject('stale');
        source = (
          await sql.query<{
            id: string;
            content: string;
            submission_id: string;
          }>(
            `SELECT t.id,t.content,t.submission_id FROM turns t JOIN voice_items v ON v.turn_id=t.id WHERE v.call_id=$1 AND v.item_id=$2 AND v.role='user' AND v.finalized`,
            [context.callId, context.sourceItem],
          )
        ).rows[0];
        if (!source) return reject('pending');
      }
      if (!source) return reject('stale');
      const submissionId = context.submissionId ?? source.submission_id!;
      const receipt = (
        await sql.query<{
          ask_onboarding: boolean;
          permitted_goal: PolicyGoal | null;
          exit_evidence: string | null;
        }>(
          'SELECT ask_onboarding, permitted_goal, exit_evidence FROM onboarding_assessments WHERE conversation_id = $1 AND submission_id = $2',
          [context.conversationId, submissionId],
        )
      ).rows[0];
      if (receipt) {
        await this.advance(sql, context.conversationId, !!context.callId);
        const current = (
          await sql.query<{ revision: number }>(
            'SELECT revision FROM conversations WHERE id=$1',
            [context.conversationId],
          )
        ).rows[0];
        state = await this.read(sql, context.conversationId, current.revision);
        const goal = this.nextGoal(state, receipt.ask_onboarding);
        await sql.query(
          `UPDATE onboarding_assessments SET question=NULL,permitted_goal=$3,visit_id=$4
          WHERE conversation_id=$1 AND submission_id=$2`,
          [context.conversationId, submissionId, goal, state.policy!.visitId],
        );
        return {
          ok: true,
          code: 'already_applied',
          state,
          permittedGoal: goal,
          exitRequested: !!receipt.exit_evidence,
        };
      }
      sources = [source];
      if (context.callId) {
        // A pause may split one volunteered answer into several provider items.
        // During onboarding, retain a bounded current-call context so a missed
        // fact can be recovered. Main-experience capture uses the unassessed
        // suffix. Reserved sequence survives delayed ASR; receipts deduplicate.
        const batch = await sql.query<Source & { finalized: boolean }>(
          `SELECT v.turn_id AS id,t.content,v.submission_id,v.finalized FROM voice_items v
           LEFT JOIN turns t ON t.id=v.turn_id
           WHERE v.call_id=$1 AND v.role='user' AND NOT v.discarded AND (NOT v.finalized OR t.id IS NOT NULL)
           AND v.sequence <= (SELECT sequence FROM voice_items WHERE call_id=$1 AND item_id=$2)
           AND ($4 OR v.sequence > COALESCE((SELECT max(prior.sequence) FROM voice_items prior
             JOIN onboarding_assessments a ON a.submission_id=prior.submission_id AND a.conversation_id=$3
             WHERE prior.call_id=$1 AND prior.role='user'),0))
           ORDER BY v.sequence DESC LIMIT 8`,
          [
            context.callId,
            context.sourceItem,
            context.conversationId,
            !state.graduated,
          ],
        );
        if (batch.rows.some((s) => !s.finalized)) return reject('pending');
        sources = batch.rows.reverse();
      }
      if (!validCommand(command)) return reject('invalid');
      const parsedIntake =
        intakeInput === undefined
          ? undefined
          : intakeInputSchema.safeParse(intakeInput);
      if (parsedIntake && !parsedIntake.success) return reject('invalid');
      const update = parsedIntake?.success ? parsedIntake.data : undefined;
      const quote = (text: string, part: string) =>
        context.callId
          ? spokenQuote(text, part)
          : normalized(text).includes(normalized(part))
            ? part
            : undefined;
      // Saving a call transcript bumps the revision without changing
      // onboarding, so an interpretation that started before it is still
      // current unless onboarding itself changed.
      const onboardingUnchanged =
        !!context.callId &&
        (lenient ||
          (command.changes.length > 0 &&
            !command.askOnboarding &&
            !command.preferences?.length &&
            !command.exitEvidence)) &&
        command.expectedRevision >= conversation.onboarding_revision &&
        command.expectedRevision <= conversation.revision;
      if (
        command.expectedRevision !== conversation.revision &&
        !onboardingUnchanged
      )
        return reject('stale');
      // Set when a lenient capture drops something not already saved, so the
      // guide can ask the user to confirm it.
      let unverified = false;
      const quoted = (e: string) => sources.some((s) => quote(s.content, e));
      const same = (a: string | null | undefined, b: string | null) =>
        !!a &&
        !!b &&
        a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
      if (update) {
        const tasks = update.tasks.filter(
          (t) => quoted(t.evidence) && quote(t.evidence, t.value),
        );
        const noTasks =
          update.noTasksEvidence && quoted(update.noTasksEvidence)
            ? update.noTasksEvidence
            : null;
        if (
          tasks.length < update.tasks.length ||
          noTasks !== update.noTasksEvidence
        ) {
          if (!lenient) return reject('invalid');
          unverified ||=
            noTasks !== update.noTasksEvidence ||
            update.tasks.some(
              (t) =>
                !tasks.includes(t) &&
                !state.intake?.tasks.some((saved) => same(saved, t.value)),
            );
          update.tasks = tasks;
          update.noTasksEvidence = noTasks;
          // Never let a dropped replacement clear the saved list.
          update.replaceTasks &&= tasks.length > 0;
        }
      }
      const changes: (Change & { source: Source })[] = [];
      for (const change of command.changes) {
        let match: (Change & { source: Source }) | undefined;
        for (const candidate of sources.toReversed()) {
          const evidence = quote(candidate.content, change.evidence);
          if (!evidence) continue;
          const value =
            change.value === null
              ? null
              : (quote(evidence, change.value) ??
                (change.goal === 'helpRequest'
                  ? undefined
                  : spelledName(evidence, change.value)));
          if (value !== undefined) {
            match = { ...change, evidence, value, source: candidate };
            break;
          }
        }
        if (!match) {
          if (!lenient) return reject('invalid');
          unverified ||= !same(state.facts[change.goal].value, change.value);
          continue;
        }
        changes.push(match);
      }
      const preferences = (command.preferences ?? []).map((p) => ({
        ...p,
        sourceIndex: sources.findLastIndex(
          (candidate) => quote(candidate.content, p.evidence) !== undefined,
        ),
      }));
      if (preferences.some((p) => p.sourceIndex < 0)) {
        if (!lenient) return reject('invalid');
        unverified = true;
        preferences.splice(
          0,
          preferences.length,
          ...preferences.filter((p) => p.sourceIndex >= 0),
        );
      }
      if (command.exitEvidence && !quoted(command.exitEvidence)) {
        if (!lenient) return reject('invalid');
        unverified = true;
        command.exitEvidence = null;
      }
      notes = (Array.isArray(memory) ? memory.slice(0, 3) : []).flatMap(
        (note: unknown) => {
          if (
            !object(note) ||
            !exactKeys(note, ['kind', 'value', 'evidence']) ||
            !noteKinds.includes(note.kind as never) ||
            typeof note.value !== 'string' ||
            !note.value.trim() ||
            note.value.length > 300 ||
            typeof note.evidence !== 'string' ||
            !note.evidence.trim() ||
            note.evidence.length > 8000
          )
            return [];
          for (const candidate of sources.toReversed()) {
            const evidence = quote(candidate.content, note.evidence);
            const value = evidence && quote(evidence, note.value);
            if (value)
              return [{ kind: note.kind as MemoryNote['kind'], value }];
          }
          return [];
        },
      );
      await this.policy.apply(
        sql,
        context.conversationId,
        preferences.toSorted((a, b) => a.sourceIndex - b.sourceIndex),
      );
      {
        const revision = conversation.revision + 1;
        for (const change of changes) {
          const prior = state.facts[change.goal];
          const ambiguous =
            change.action === 'clarify' ||
            (prior.value !== null &&
              prior.value !== change.value &&
              change.action !== 'correct');
          await sql.query(
            `INSERT INTO onboarding_facts(id, conversation_id, goal, value, status, source_turn_id, revision, evidence)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              randomUUID(),
              context.conversationId,
              change.goal,
              ambiguous ? null : change.value?.trim(),
              ambiguous ? 'ambiguous' : 'known',
              change.source.id,
              revision,
              change.evidence,
            ],
          );
        }
        await sql.query(
          'UPDATE conversations SET revision = $2, onboarding_revision = $2 WHERE id = $1',
          [context.conversationId, revision],
        );
        state = await this.read(sql, context.conversationId, revision);
      }
      // Volunteering a fact reopens its goal unless the user also declined or
      // deferred it in the same source or a later part of this spoken answer.
      await this.policy.apply(
        sql,
        context.conversationId,
        changes
          .filter(
            (c) =>
              c.action !== 'clarify' &&
              !preferences.some(
                (p) =>
                  p.goal === c.goal &&
                  p.sourceIndex >= sources.indexOf(c.source),
              ),
          )
          .map((c) => ({
            goal: c.goal,
            outcome: 'open',
            evidence: c.evidence,
          })),
      );
      state = await this.read(sql, context.conversationId, state.revision);
      if (!state.graduated) {
        const currentIntake = state.intake ?? {
          ...emptyIntake(),
          ready: false,
        };
        const task =
          changes.find(
            (c) => c.goal === 'helpRequest' && c.action !== 'clarify',
          )?.value ?? undefined;
        const nextIntake = updateIntake(currentIntake, update, task);
        await sql.query(
          'UPDATE conversations SET onboarding_intake=$2 WHERE id=$1',
          [context.conversationId, JSON.stringify(nextIntake)],
        );
        // The last missing detail finishes onboarding in the same commit.
        await this.finish(sql, context.conversationId, submissionId);
      }
      await this.advance(sql, context.conversationId, !!context.callId);
      const current = (
        await sql.query<{ revision: number }>(
          'SELECT revision FROM conversations WHERE id=$1',
          [context.conversationId],
        )
      ).rows[0];
      state = await this.read(sql, context.conversationId, current.revision);
      // Declined and deferred steps are already ineligible, so the guide moves
      // on to the next one. A request to stop asking pauses setup; a request to
      // skip it still gets the next step, since setup cannot be skipped.
      const askOnboarding = command.askOnboarding || !!command.exitEvidence;
      const goal = this.nextGoal(
        state,
        askOnboarding,
        preferences.filter((p) => p.outcome === 'open').map((p) => p.goal),
      );
      for (const assessed of sources)
        await sql.query(
          `INSERT INTO onboarding_assessments(conversation_id,submission_id,ask_onboarding,question,permitted_goal,visit_id,exit_evidence)
           VALUES($1,$2,$3,NULL,$4,$5,$6) ON CONFLICT(conversation_id,submission_id) DO NOTHING`,
          [
            context.conversationId,
            assessed.submission_id ?? submissionId,
            askOnboarding,
            goal,
            state.policy!.visitId,
            command.exitEvidence ?? null,
          ],
        );
      return {
        ok: true,
        code: 'committed',
        state,
        permittedGoal: goal,
        exitRequested: !!command.exitEvidence,
        ...(unverified ? { unverified } : {}),
      };
    });
    if (result.code !== 'committed' || !notes.length) return result;
    const remembered = await this.memory
      .remember(context.conversationId, notes)
      .catch(() => false);
    return remembered ? { ...result, remembered: notes } : result;
  }
}
