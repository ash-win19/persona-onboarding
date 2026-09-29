import { randomUUID } from 'node:crypto';
import type { Sql } from './database.js';

export const openingMessage =
  "Hi, I'm Persona. What would you like to call me?";

// Call while creating the conversation, or while holding its row lock.
export async function saveOpening(sql: Sql, conversationId: string) {
  await sql.query(
    `INSERT INTO turns(id,conversation_id,submission_id,role,content,kind)
     SELECT $1,$2,$3,'assistant',$4,'opening'
     WHERE NOT EXISTS(SELECT 1 FROM turns WHERE conversation_id=$2)
     ON CONFLICT DO NOTHING`,
    [randomUUID(), conversationId, randomUUID(), openingMessage],
  );
}
