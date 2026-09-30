import type { Sql } from './database.js';
import type { OnboardingState } from './onboarding.js';

export const handoffMessage =
  "I've got enough to get you started. Let's head to your dashboard.";
export const skipMessage =
  "Let's get you started. You can bring your first task when you're ready.";

export async function readJourney(
  sql: Sql,
  id: string,
  state: OnboardingState,
) {
  const row = (
    await sql.query<{
      handoff_prepared_at: Date | null;
      dashboard_entered_at: Date | null;
      handoff_delivery: 'text' | 'waiting' | 'played';
      handoff_message: string | null;
      handoff_active: boolean;
      interrupted: boolean;
    }>(
      `SELECT handoff_prepared_at,dashboard_entered_at,handoff_delivery,handoff_message,
    EXISTS(SELECT 1 FROM calls WHERE id=c.handoff_call_id AND status='active') AS handoff_active,
    EXISTS(SELECT 1 FROM voice_responses WHERE call_id=c.handoff_call_id AND response_id=c.handoff_response_id AND interrupted) AS interrupted
    FROM conversations c WHERE id=$1`,
      [id],
    )
  ).rows[0];
  return {
    ready:
      state.graduated ||
      !!row.handoff_prepared_at ||
      !!row.dashboard_entered_at,
    prepared: !!row.handoff_prepared_at,
    entered: !!row.dashboard_entered_at,
    message: row.handoff_message ?? handoffMessage,
    delivery:
      row.handoff_delivery === 'waiting' &&
      (!row.handoff_active || row.interrupted)
        ? ('text' as const)
        : row.handoff_delivery,
  };
}
