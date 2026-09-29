import type { Sql } from './database.js';
import type { OnboardingState } from './onboarding.js';

export const handoffMessage =
  "I've got enough to get you started. Let's head to your dashboard.";
export const skipMessage =
  "Let's get you started. You can bring your first task when you're ready.";

// Existing goal offers are selected before generation. Only delivered turns
// count as invitations here; failed generation and interrupted speech do not.
const invitations = {
  agentName: /what would you like to call me/i,
  userName: /what name would you like me to use for you/i,
  helpRequest: /what would you like help with/i,
  gmail: /would you like to connect gmail/i,
  voice: /would you like to talk this through on a call/i,
};

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
      active: boolean;
      handoff_active: boolean;
      interrupted: boolean;
    }>(
      `SELECT handoff_prepared_at,dashboard_entered_at,handoff_delivery,handoff_message,
    EXISTS(SELECT 1 FROM calls WHERE conversation_id=$1 AND status IN ('connecting','active')) AS active,
    EXISTS(SELECT 1 FROM calls WHERE id=c.handoff_call_id AND status='active') AS handoff_active,
    EXISTS(SELECT 1 FROM voice_responses WHERE call_id=c.handoff_call_id AND response_id=c.handoff_response_id AND interrupted) AS interrupted
    FROM conversations c WHERE id=$1`,
      [id],
    )
  ).rows[0];
  const delivered = (
    await sql.query<{ content: string }>(
      "SELECT content FROM turns WHERE conversation_id=$1 AND role='assistant' AND delivery IN ('text','played')",
      [id],
    )
  ).rows;
  const attempted = (goal: keyof typeof invitations) => {
    const policy = state.policy?.goals[goal];
    return (
      policy?.outcome === 'declined' ||
      policy?.outcome === 'deferred' ||
      !!(
        policy?.introduced &&
        delivered.some((turn) => invitations[goal].test(turn.content))
      )
    );
  };
  const ready =
    !!row.handoff_prepared_at ||
    !!row.dashboard_entered_at ||
    (state.facts.helpRequest.status === 'known' &&
      (state.facts.agentName.status === 'known' ||
        row.active ||
        attempted('agentName')) &&
      (state.facts.userName.status === 'known' || attempted('userName')) &&
      (state.gmail === 'connected' ||
        state.gmailAvailable === false ||
        attempted('gmail')) &&
      (row.active || state.call === 'successful' || attempted('voice')));
  return {
    ready,
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
