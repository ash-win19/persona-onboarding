import type { Database } from './database.js';
import { saveOpening } from './opening.js';

export async function migrate(db: Database) {
  await db.transaction(async (sql) => {
    await sql.query(`CREATE TABLE IF NOT EXISTS conversations (
      id uuid PRIMARY KEY, credential_hash text NOT NULL UNIQUE,
      revision integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await sql.query(`CREATE TABLE IF NOT EXISTS turns (
      sequence bigserial PRIMARY KEY, id uuid NOT NULL UNIQUE,
      conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      submission_id uuid NOT NULL, role text NOT NULL CHECK (role IN ('user', 'assistant')),
      content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (conversation_id, submission_id, role)
    )`);
    await sql.query(`CREATE TABLE IF NOT EXISTS submissions (
      conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      id uuid NOT NULL, content text NOT NULL,
      status text NOT NULL CHECK (status IN ('generating', 'completed', 'failed')),
      attempt uuid NOT NULL, lease_until timestamptz NOT NULL,
      error_code text, created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (conversation_id, id)
    )`);
    await sql.query(
      'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS gmail_verified_at timestamptz, ADD COLUMN IF NOT EXISTS call_successful_at timestamptz',
    );
    await sql.query(`CREATE TABLE IF NOT EXISTS onboarding_facts (
      id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      goal text NOT NULL CHECK (goal IN ('agentName', 'userName', 'helpRequest')),
      value text, status text NOT NULL CHECK (status IN ('known', 'ambiguous')),
      source_turn_id uuid NOT NULL REFERENCES turns(id), revision integer NOT NULL,
      evidence text NOT NULL, UNIQUE(conversation_id, goal, revision)
    )`);
    await sql.query(`CREATE TABLE IF NOT EXISTS onboarding_assessments (
      conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      submission_id uuid NOT NULL, ask_onboarding boolean NOT NULL,
      PRIMARY KEY(conversation_id, submission_id),
      FOREIGN KEY(conversation_id, submission_id) REFERENCES submissions(conversation_id, id) ON DELETE CASCADE
    )`);
    await sql.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS owner_tab uuid,
      ADD COLUMN IF NOT EXISTS owner_epoch integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS owner_until timestamptz`);
    await sql.query(
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS owner_epoch integer NOT NULL DEFAULT 0',
    );
    await sql.query(`CREATE TABLE IF NOT EXISTS calls (
      id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      owner_tab uuid NOT NULL, owner_epoch integer NOT NULL, instance_id uuid NOT NULL,
      provider_id text, status text NOT NULL CHECK(status IN ('connecting','active','ended','failed')),
      reason text, created_at timestamptz NOT NULL, deadline timestamptz NOT NULL, ended_at timestamptz,
      control_seen_at timestamptz, tool_acknowledged boolean NOT NULL DEFAULT false
    )`);
    await sql.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS one_open_call ON calls(conversation_id) WHERE status IN ('connecting','active')`,
    );
    await sql.query(`CREATE TABLE IF NOT EXISTS voice_items (
      call_id uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE, item_id text NOT NULL,
      previous_item_id text, turn_id uuid NOT NULL UNIQUE, submission_id uuid NOT NULL,
      sequence bigint NOT NULL DEFAULT nextval('turns_sequence_seq'), role text NOT NULL,
      response_id text, finalized boolean NOT NULL DEFAULT false, interrupted boolean NOT NULL DEFAULT false,
      PRIMARY KEY(call_id,item_id)
    )`);
    await sql.query(`ALTER TABLE turns ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'text',
      ADD COLUMN IF NOT EXISTS delivery text NOT NULL DEFAULT 'text', ADD COLUMN IF NOT EXISTS call_id uuid`);
    await sql.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS visit_id uuid,
      ADD COLUMN IF NOT EXISTS last_activity timestamptz`);
    await sql.query(`CREATE TABLE IF NOT EXISTS onboarding_policy (
      conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      goal text NOT NULL, outcome text NOT NULL CHECK(outcome IN ('open','declined','deferred')),
      offered_visit uuid, deferred_visit uuid, PRIMARY KEY(conversation_id,goal)
    )`);
    await sql.query(
      'ALTER TABLE onboarding_assessments ADD COLUMN IF NOT EXISTS question text',
    );
    await sql.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS source_item_id text`);
    await sql.query(
      'ALTER TABLE voice_items ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0',
    );
    await sql.query(`CREATE TABLE IF NOT EXISTS voice_responses (
      call_id uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE, response_id text NOT NULL,
      generation integer NOT NULL, interrupted boolean NOT NULL DEFAULT false, played boolean NOT NULL DEFAULT false,
      PRIMARY KEY(call_id,response_id)
    )`);
    await sql.query(
      'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS gmail_generation integer NOT NULL DEFAULT 0',
    );
    await sql.query(`CREATE TABLE IF NOT EXISTS gmail_attempts (
      id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      generation integer NOT NULL, state_hash text NOT NULL UNIQUE, verifier text, status text NOT NULL,
      expires_at timestamptz NOT NULL, UNIQUE(conversation_id,generation)
    )`);
    await sql.query(`CREATE TABLE IF NOT EXISTS gmail_connections (
      conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      generation integer NOT NULL, email text NOT NULL, tokens text NOT NULL, expires_at timestamptz NOT NULL,
      checked_at timestamptz NOT NULL, status text NOT NULL
    )`);
    await sql.query(
      'ALTER TABLE onboarding_assessments DROP CONSTRAINT IF EXISTS onboarding_assessments_conversation_id_submission_id_fkey',
    );
    await sql.query(
      'ALTER TABLE voice_responses ADD COLUMN IF NOT EXISTS source_item_id text',
    );
    await sql.query(`CREATE TABLE IF NOT EXISTS reset_receipts (
      old_hash text PRIMARY KEY, new_hash text NOT NULL, operation_id uuid NOT NULL,
      new_conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await sql.query(`CREATE TABLE IF NOT EXISTS operational_events (
      id uuid PRIMARY KEY, at timestamptz NOT NULL, code text NOT NULL, subject_id uuid NOT NULL,duration_ms integer
    )`);
    await sql.query(
      'CREATE INDEX IF NOT EXISTS operational_retention ON operational_events(at)',
    );
    await sql.query(
      'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS onboarding_revision integer',
    );
    await sql.query(
      'UPDATE conversations SET onboarding_revision=revision WHERE onboarding_revision IS NULL',
    );
    await sql.query(
      'ALTER TABLE conversations ALTER COLUMN onboarding_revision SET DEFAULT 0, ALTER COLUMN onboarding_revision SET NOT NULL',
    );
    await sql.query(`CREATE TABLE IF NOT EXISTS accounts (
      id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
      conversation_id uuid UNIQUE REFERENCES conversations(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await sql.query(`CREATE TABLE IF NOT EXISTS account_sessions (
      token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    )`);
    await sql.query(
      'CREATE INDEX IF NOT EXISTS account_sessions_owner ON account_sessions(account_id)',
    );
    await sql.query(
      'ALTER TABLE account_sessions ADD COLUMN IF NOT EXISTS family_hash text, ADD COLUMN IF NOT EXISTS revoked_at timestamptz',
    );
    await sql.query(
      'UPDATE account_sessions SET family_hash=token_hash WHERE family_hash IS NULL',
    );
    await sql.query(
      'ALTER TABLE account_sessions ALTER COLUMN family_hash SET NOT NULL',
    );
    await sql.query(
      'CREATE INDEX IF NOT EXISTS account_sessions_family ON account_sessions(family_hash)',
    );
    await sql.query(`CREATE TABLE IF NOT EXISTS login_limits (
      key text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL
    )`);
    await sql.query(
      "ALTER TABLE turns ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'message'",
    );
    await sql.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS one_opening ON turns(conversation_id) WHERE kind='opening'",
    );
    await sql.query(
      'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS introduced_at timestamptz',
    );
    await sql.query(
      'ALTER TABLE calls ADD COLUMN IF NOT EXISTS opening_started boolean NOT NULL DEFAULT false',
    );
    await sql.query(
      'ALTER TABLE accounts ADD COLUMN IF NOT EXISTS fresh_start boolean NOT NULL DEFAULT false',
    );
    const existingPhase = await sql.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name='conversations' AND column_name='graduated_at'",
    );
    await sql.query(
      'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS graduated_at timestamptz',
    );
    if (!existingPhase.rows.length)
      await sql.query(`UPDATE conversations c SET graduated_at=now() WHERE EXISTS(
        SELECT 1 FROM onboarding_facts f WHERE f.conversation_id=c.id AND f.goal='helpRequest' AND f.status='known')`);
    await sql.query(`ALTER TABLE onboarding_assessments ADD COLUMN IF NOT EXISTS permitted_goal text,
      ADD COLUMN IF NOT EXISTS visit_id uuid, ADD COLUMN IF NOT EXISTS delivered boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS exit_evidence text`);
    await sql.query(
      `ALTER TABLE calls ADD COLUMN IF NOT EXISTS opening_goal text, ADD COLUMN IF NOT EXISTS opening_visit uuid`,
    );
    await sql.query(`ALTER TABLE voice_responses ADD COLUMN IF NOT EXISTS onboarding_goal text,
      ADD COLUMN IF NOT EXISTS onboarding_visit uuid, ADD COLUMN IF NOT EXISTS invitation_delivered boolean NOT NULL DEFAULT false`);
    const empty = await sql.query<{ id: string }>(
      `SELECT id FROM conversations c WHERE NOT EXISTS(SELECT 1 FROM turns WHERE conversation_id=c.id)
       AND NOT EXISTS(SELECT 1 FROM calls WHERE conversation_id=c.id) FOR UPDATE`,
    );
    for (const conversation of empty.rows)
      await saveOpening(sql, conversation.id);
  });
}
