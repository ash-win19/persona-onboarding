import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from './authority.js';
import type { Sql } from './database.js';

export const policyGoals = [
  'agentName',
  'userName',
  'helpRequest',
  'gmail',
  'voice',
] as const;
export type PolicyGoal = (typeof policyGoals)[number];
export type Preference = {
  goal: PolicyGoal;
  outcome: 'declined' | 'deferred' | 'open';
  evidence: string;
};
export type PolicyState = {
  visitId: string;
  goals: Record<
    PolicyGoal,
    {
      outcome: 'open' | 'declined' | 'deferred';
      eligible: boolean;
      introduced: boolean;
    }
  >;
};
type Row = {
  goal: PolicyGoal;
  outcome: 'open' | 'declined' | 'deferred';
  offered_visit: string | null;
  deferred_visit: string | null;
};
@Injectable()
export class OnboardingPolicy {
  constructor(@Inject(CLOCK) private readonly now: Clock) {}
  async activity(sql: Sql, id: string) {
    const c = (
      await sql.query<{
        visit_id: string | null;
        last_activity: Date | null;
        active: boolean;
      }>(
        `SELECT visit_id,last_activity,EXISTS(SELECT 1 FROM calls WHERE conversation_id=$1 AND status IN ('connecting','active')) AS active FROM conversations WHERE id=$1 FOR UPDATE`,
        [id],
      )
    ).rows[0];
    if (!c) throw new Error('CONVERSATION_UNAVAILABLE');
    const visit =
      !c.visit_id ||
      (!c.active &&
        (!c.last_activity ||
          this.now() - new Date(c.last_activity).getTime() >= 1800000))
        ? randomUUID()
        : c.visit_id;
    await sql.query(
      'UPDATE conversations SET visit_id=$2,last_activity=$3 WHERE id=$1',
      [id, visit, new Date(this.now())],
    );
    return visit;
  }
  async read(sql: Sql, id: string): Promise<PolicyState> {
    const c = (
      await sql.query<{ visit_id: string }>(
        'SELECT visit_id FROM conversations WHERE id=$1',
        [id],
      )
    ).rows[0];
    const rows = (
      await sql.query<Row>(
        'SELECT * FROM onboarding_policy WHERE conversation_id=$1',
        [id],
      )
    ).rows;
    const goals = {} as PolicyState['goals'];
    for (const goal of policyGoals) {
      const row = rows.find((r) => r.goal === goal);
      goals[goal] = {
        outcome: row?.outcome ?? 'open',
        introduced: !!row?.offered_visit,
        eligible:
          row?.outcome !== 'declined' &&
          row?.offered_visit !== c.visit_id &&
          !(row?.outcome === 'deferred' && row.deferred_visit === c.visit_id),
      };
    }
    return { visitId: c.visit_id, goals };
  }
  async apply(sql: Sql, id: string, preferences: Preference[]) {
    const state = await this.read(sql, id);
    for (const p of preferences)
      await sql.query(
        `INSERT INTO onboarding_policy(conversation_id,goal,outcome,deferred_visit) VALUES($1,$2,$3,$4)
       ON CONFLICT(conversation_id,goal) DO UPDATE SET outcome=$3,deferred_visit=$4,offered_visit=CASE WHEN $3='open' THEN NULL ELSE onboarding_policy.offered_visit END`,
        [
          id,
          p.goal,
          p.outcome,
          p.outcome === 'deferred' ? state.visitId : null,
        ],
      );
  }
  async offer(sql: Sql, id: string, goal: PolicyGoal) {
    const state = await this.read(sql, id);
    if (!state.goals[goal].eligible) return false;
    await sql.query(
      `INSERT INTO onboarding_policy(conversation_id,goal,outcome,offered_visit) VALUES($1,$2,'open',$3)
      ON CONFLICT(conversation_id,goal) DO UPDATE SET offered_visit=$3`,
      [id, goal, state.visitId],
    );
    return true;
  }
}
