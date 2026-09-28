import type { Database } from './database.js';

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
  });
}
