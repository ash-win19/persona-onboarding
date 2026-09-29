import { Gmail } from './gmail.js';
import type { MemoryContext } from './memory.js';
import { Authority } from './authority.js';
import { Inject, Injectable } from '@nestjs/common';
import {
  OnboardingPolicy,
  policyGoals,
  type Preference,
  type PolicyState,
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
  revision: number;
  policy?: PolicyState;
  facts: Record<Goal, Fact>;
  gmail: 'connected' | 'not_connected';
  gmailAvailable?: boolean;
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
  question: string | null;
  source?: { turnId: string; text: string };
  sources?: { turnId: string; text: string }[];
  remembered?: MemoryNote[];
};
export interface OnboardingTools {
  state: OnboardingState;
  memory?: MemoryContext | null;
  capture(command: unknown): Promise<CaptureResult>;
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
};
type Event = Record<string, unknown> & {
  goal: Goal;
  value: string | null;
  status: 'known' | 'ambiguous';
  sourceTurnId: string;
  revision: number;
};

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
function validCommand(value: unknown): value is Command {
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
        gmail_pending: boolean;
      }>(
        `SELECT gmail_verified_at,call_successful_at,
          EXISTS(SELECT 1 FROM calls WHERE conversation_id=$1 AND status IN ('connecting','active')) AS call_active,
          EXISTS(SELECT 1 FROM gmail_attempts WHERE conversation_id=$1 AND status IN ('pending','exchanging') AND expires_at>$2) AS gmail_pending
          FROM conversations WHERE id=$1`,
        [conversationId, new Date(this.authority.now())],
      )
    ).rows[0];
    const gmail = integration.gmail_verified_at ? 'connected' : 'not_connected';
    const graduated = !!facts.helpRequest.value;
    const policy = await this.policy.read(sql, conversationId);
    for (const goal of goals)
      if (facts[goal].status === 'known') policy.goals[goal].eligible = false;
    if (integration.call_active || integration.call_successful_at)
      policy.goals.voice.eligible = false;
    if (
      gmail === 'connected' ||
      integration.gmail_pending ||
      !this.gmail.available()
    )
      policy.goals.gmail.eligible = false;
    return {
      revision,
      policy,
      facts,
      gmail,
      gmailAvailable: this.gmail.available(),
      call: integration.call_successful_at ? 'successful' : 'not_started',
      graduated,
      onboardingComplete:
        goals.every((goal) => facts[goal].status === 'known') &&
        gmail === 'connected',
      mode: graduated ? 'helping' : 'onboarding',
      missingGoals: [
        ...goals.filter((goal) => facts[goal].status !== 'known'),
        ...(gmail === 'not_connected' ? ['gmail'] : []),
      ],
    };
  }

  async callOpening(sql: Sql, id: string, revision: number) {
    const state = await this.read(sql, id, revision);
    if (state.graduated)
      return 'Continue the existing help request using the saved conversation. Give one short useful next step or ask one focused task question. Do not restart onboarding.';
    const question = await this.question(sql, id, state, true, true);
    return question
      ? `Briefly greet the user, then ask exactly this question: ${question}`
      : 'Briefly greet the user and say you are here when they are ready. Do not ask another onboarding question.';
  }

  private async question(
    sql: Sql,
    id: string,
    state: OnboardingState,
    ask: boolean,
    voice = false,
  ): Promise<string | null> {
    if (!ask) return null;
    const active =
      (
        await sql.query(
          "SELECT id FROM calls WHERE conversation_id=$1 AND status IN ('connecting','active')",
          [id],
        )
      ).rows.length > 0;
    const candidates = [
      ...goals.filter((g) => state.facts[g].status === 'ambiguous'),
      ...(!state.facts.agentName.value && !state.graduated
        ? ['agentName' as const]
        : []),
      ...(!active && state.call !== 'successful' ? ['voice' as const] : []),
      ...goals.filter(
        (g) =>
          !state.facts[g].value && (g !== 'helpRequest' || !state.graduated),
      ),
      ...(state.gmail !== 'connected' && state.gmailAvailable !== false
        ? ['gmail' as const]
        : []),
    ];
    for (const goal of candidates) {
      if (voice && goal === 'agentName') continue;
      if (state.policy && !state.policy.goals[goal].eligible) continue;
      if (await this.policy.offer(sql, id, goal))
        return {
          agentName: 'What would you like to call me?',
          userName: 'What name would you like me to use for you?',
          helpRequest: 'What would you like help with?',
          voice:
            'Would you like to talk this through on a call? You can use Start a call whenever you are ready.',
          gmail: 'Would you like to connect Gmail, or keep going here for now?',
        }[goal];
    }
    return null;
  }

  async capture(context: FactContext, input: unknown): Promise<CaptureResult> {
    // Working memory is optional and never invalidates an otherwise valid capture.
    const { memory, ...command }: Record<string, unknown> = object(input)
      ? input
      : {};
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
        question: null,
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
        await sql.query<{ ask_onboarding: boolean; question: string | null }>(
          'SELECT question, ask_onboarding FROM onboarding_assessments WHERE conversation_id = $1 AND submission_id = $2',
          [context.conversationId, submissionId],
        )
      ).rows[0];
      if (receipt)
        return {
          ok: true,
          code: 'already_applied',
          state,
          question: receipt.question,
        };
      sources = [source];
      if (context.callId) {
        // A pause may split one volunteered answer into several provider items.
        // Use only the unassessed suffix of this call, never a previous call or
        // an already-consumed answer. Reserved sequence survives delayed ASR.
        const batch = await sql.query<Source & { finalized: boolean }>(
          `SELECT v.turn_id AS id,t.content,v.submission_id,v.finalized FROM voice_items v
           LEFT JOIN turns t ON t.id=v.turn_id
           WHERE v.call_id=$1 AND v.role='user' AND (NOT v.finalized OR t.id IS NOT NULL)
           AND v.sequence <= (SELECT sequence FROM voice_items WHERE call_id=$1 AND item_id=$2)
           AND v.sequence > COALESCE((SELECT max(prior.sequence) FROM voice_items prior
             JOIN onboarding_assessments a ON a.submission_id=prior.submission_id AND a.conversation_id=$3
             WHERE prior.call_id=$1 AND prior.role='user'),0)
           ORDER BY v.sequence DESC LIMIT 8`,
          [context.callId, context.sourceItem, context.conversationId],
        );
        if (batch.rows.some((s) => !s.finalized)) return reject('pending');
        sources = batch.rows.reverse();
      }
      if (!validCommand(command)) return reject('invalid');
      const quote = (text: string, part: string) =>
        context.callId
          ? spokenQuote(text, part)
          : normalized(text).includes(normalized(part))
            ? part
            : undefined;
      const onboardingUnchanged =
        !!context.callId &&
        command.changes.length > 0 &&
        !command.askOnboarding &&
        !command.preferences?.length &&
        command.expectedRevision >= conversation.onboarding_revision &&
        command.expectedRevision <= conversation.revision;
      if (
        command.expectedRevision !== conversation.revision &&
        !onboardingUnchanged
      )
        return reject('stale');
      const changes: (Change & { source: Source })[] = [];
      for (const change of command.changes) {
        let match: (Change & { source: Source }) | undefined;
        for (const candidate of sources.toReversed()) {
          const evidence = quote(candidate.content, change.evidence);
          if (!evidence) continue;
          const value =
            change.value === null ? null : quote(evidence, change.value);
          if (value !== undefined) {
            match = { ...change, evidence, value, source: candidate };
            break;
          }
        }
        if (!match) return reject('invalid');
        changes.push(match);
      }
      const preferences = (command.preferences ?? []).map((p) => ({
        ...p,
        sourceIndex: sources.findLastIndex(
          (candidate) => quote(candidate.content, p.evidence) !== undefined,
        ),
      }));
      if (preferences.some((p) => p.sourceIndex < 0)) return reject('invalid');
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
      const question = await this.question(
        sql,
        context.conversationId,
        state,
        command.askOnboarding,
        !!context.callId,
      );
      state = await this.read(sql, context.conversationId, state.revision);
      for (const assessed of sources)
        await sql.query(
          'INSERT INTO onboarding_assessments(conversation_id,submission_id,ask_onboarding,question) VALUES($1,$2,$3,$4)',
          [
            context.conversationId,
            assessed.submission_id ?? submissionId,
            command.askOnboarding,
            question,
          ],
        );
      return {
        ok: true,
        code: 'committed',
        state,
        question,
      };
    });
    if (result.code !== 'committed' || !notes.length) return result;
    const remembered = await this.memory
      .remember(context.conversationId, notes)
      .catch(() => false);
    return remembered ? { ...result, remembered: notes } : result;
  }
}
