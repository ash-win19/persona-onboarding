import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE, type Database, type Sql } from './database.js';

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
  facts: Record<Goal, Fact>;
  gmail: 'connected' | 'not_connected';
  call: 'successful' | 'not_started';
  graduated: boolean;
  onboardingComplete: boolean;
  mode: 'helping' | 'onboarding';
  missingGoals: string[];
};
export type CaptureResult = {
  ok: boolean;
  code: 'committed' | 'already_applied' | 'invalid' | 'stale';
  state: OnboardingState;
  question: string | null;
};
export interface OnboardingTools {
  state: OnboardingState;
  capture(command: unknown): Promise<CaptureResult>;
}
// Only the authenticated coordinator supplies this context, never model arguments.
export type FactContext = {
  conversationId: string;
  submissionId: string;
  attempt: string;
};
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
function validCommand(value: unknown): value is Command {
  if (
    !object(value) ||
    !exactKeys(value, ['expectedRevision', 'askOnboarding', 'changes']) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    Number(value.expectedRevision) < 0 ||
    typeof value.askOnboarding !== 'boolean' ||
    !Array.isArray(value.changes) ||
    value.changes.length > 3
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

export function nextOnboardingQuestion(
  state: OnboardingState,
  ask: boolean,
): string | null {
  const ambiguous = goals.find(
    (goal) => state.facts[goal].status === 'ambiguous',
  );
  const goal =
    ambiguous ??
    (ask && !state.graduated
      ? goals.find((key) => !state.facts[key].value)
      : undefined);
  if (!goal) return null;
  return {
    agentName: 'What would you like to call me?',
    userName: 'What name would you like me to use for you?',
    helpRequest: 'What would you like help with?',
  }[goal];
}

@Injectable()
export class OnboardingService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

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
      }>(
        'SELECT gmail_verified_at, call_successful_at FROM conversations WHERE id = $1',
        [conversationId],
      )
    ).rows[0];
    const gmail = integration.gmail_verified_at ? 'connected' : 'not_connected';
    const graduated = !!facts.helpRequest.value;
    return {
      revision,
      facts,
      gmail,
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

  async capture(
    context: FactContext,
    command: unknown,
  ): Promise<CaptureResult> {
    return this.db.transaction(async (sql) => {
      const conversation = (
        await sql.query<{ revision: number }>(
          'SELECT revision FROM conversations WHERE id = $1 FOR UPDATE',
          [context.conversationId],
        )
      ).rows[0];
      if (!conversation) throw new Error('CONVERSATION_UNAVAILABLE');
      let state = await this.read(
        sql,
        context.conversationId,
        conversation.revision,
      );
      const reject = (code: 'invalid' | 'stale'): CaptureResult => ({
        ok: false,
        code,
        state,
        question: null,
      });
      const source = (
        await sql.query<{ id: string; content: string }>(
          `SELECT t.id, t.content FROM turns t JOIN submissions s
        ON s.conversation_id = t.conversation_id AND s.id = t.submission_id
        WHERE t.conversation_id = $1 AND t.submission_id = $2 AND t.role = 'user'
        AND s.attempt = $3 AND s.status = 'generating' AND s.lease_until > now()`,
          [context.conversationId, context.submissionId, context.attempt],
        )
      ).rows[0];
      if (!source) return reject('stale');
      if (!validCommand(command)) return reject('invalid');
      const receipt = (
        await sql.query<{ ask_onboarding: boolean }>(
          'SELECT ask_onboarding FROM onboarding_assessments WHERE conversation_id = $1 AND submission_id = $2',
          [context.conversationId, context.submissionId],
        )
      ).rows[0];
      if (receipt)
        return {
          ok: true,
          code: 'already_applied',
          state,
          question: nextOnboardingQuestion(state, receipt.ask_onboarding),
        };
      if (command.expectedRevision !== conversation.revision)
        return reject('stale');
      if (
        command.changes.some(
          (change) =>
            !normalized(source.content).includes(normalized(change.evidence)) ||
            (change.value !== null &&
              !normalized(change.evidence).includes(normalized(change.value))),
        )
      )
        return reject('invalid');
      if (command.changes.length) {
        const revision = conversation.revision + 1;
        for (const change of command.changes) {
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
              source.id,
              revision,
              change.evidence,
            ],
          );
        }
        await sql.query(
          'UPDATE conversations SET revision = $2 WHERE id = $1',
          [context.conversationId, revision],
        );
        state = await this.read(sql, context.conversationId, revision);
      }
      await sql.query(
        'INSERT INTO onboarding_assessments(conversation_id, submission_id, ask_onboarding) VALUES ($1,$2,$3)',
        [context.conversationId, context.submissionId, command.askOnboarding],
      );
      return {
        ok: true,
        code: 'committed',
        state,
        question: nextOnboardingQuestion(state, command.askOnboarding),
      };
    });
  }
}
