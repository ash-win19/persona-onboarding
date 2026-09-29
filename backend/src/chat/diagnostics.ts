import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE, type Database } from './database.js';
export type DiagnosticCode =
  | 'CALL_STARTED'
  | 'CALL_ENDED'
  | 'VOICE_CONTROL_LOST'
  | 'GMAIL_CONNECTED'
  | 'GMAIL_FAILED'
  | 'SESSION_RESET'
  | 'REPLY_UNAVAILABLE'
  | 'CALL_RECAP_UNAVAILABLE';
@Injectable()
export class Diagnostics {
  constructor(@Inject(DATABASE) private readonly db: Database) {}
  async record(
    code: DiagnosticCode,
    subjectId: string,
    durationMs: number | null = null,
  ) {
    const event = {
      id: randomUUID(),
      at: new Date(),
      code,
      subjectId,
      durationMs,
    };
    // This closed schema deliberately has no content, token or provider-error field.
    console.info(JSON.stringify(event));
    await this.db
      .query(
        'INSERT INTO operational_events(id,at,code,subject_id,duration_ms) VALUES($1,$2,$3,$4,$5)',
        [event.id, event.at, code, subjectId, durationMs],
      )
      .catch(() => undefined);
  }
}
