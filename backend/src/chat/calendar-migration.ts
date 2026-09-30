import type { Sql } from './database.js';

export async function migrateCalendar(sql: Sql) {
  await sql.query(`CREATE TABLE IF NOT EXISTS calendar_attempts (
    id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    state_hash text NOT NULL UNIQUE, verifier text, nonce_hash text NOT NULL,
    status text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await sql.query(`CREATE TABLE IF NOT EXISTS calendar_connections (
    conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    generation uuid NOT NULL, subject text NOT NULL, email text NOT NULL,
    tokens text NOT NULL, status text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await sql.query(`CREATE TABLE IF NOT EXISTS meeting_requests (
    id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    source_key text NOT NULL, context_key text NOT NULL, revision integer NOT NULL DEFAULT 1,
    input jsonb NOT NULL, authorization_quote text NOT NULL, reference_at timestamptz NOT NULL,
    subject text, organizer text, status text NOT NULL DEFAULT 'draft', step text NOT NULL DEFAULT 'creating_event',
    event_id text NOT NULL UNIQUE, conference_id uuid NOT NULL, event_url text, meet_url text,
    lease_token uuid, lease_until timestamptz, next_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0, started_at timestamptz, error_code text, invite_etag text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(conversation_id,source_key)
  )`);
  await sql.query(
    'ALTER TABLE daily_entries ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()',
  );
  await sql.query(
    'CREATE INDEX IF NOT EXISTS meeting_due ON meeting_requests(status,next_at)',
  );
  await sql.query(
    'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS meeting_timezone text',
  );
}
