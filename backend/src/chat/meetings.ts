import {
  ConflictException,
  Inject,
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { Authority, type Owner } from './authority.js';
import { DATABASE, type Database, type Sql } from './database.js';
import { Calendar } from './calendar.js';
import { CalendarError, type CalendarEvent } from './calendar-provider.js';

export type MeetingContext = {
  conversationId: string;
  sourceId: string;
  threadId?: string;
  attempt?: string;
  callId?: string;
  generation?: number;
  owner?: Owner;
};
const draftSchema = z
  .object({
    draftId: z.string().uuid().nullable(),
    expectedRevision: z.number().int().nullable(),
    title: z.string().trim().min(1).max(200).nullable(),
    description: z.string().max(4000).nullable(),
    attendees: z.array(z.string().email()).max(10),
    localStart: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .nullable(),
    timeZone: z.string().max(100).nullable(),
    durationMinutes: z.number().int().min(5).max(480),
    authorizationQuote: z.string().min(3).max(8000),
  })
  .strict();
type MeetingInput = Omit<
  z.infer<typeof draftSchema>,
  'draftId' | 'expectedRevision' | 'authorizationQuote'
> & { start?: string; end?: string };
type MeetingRow = {
  id: string;
  conversation_id: string;
  source_key: string;
  context_key: string;
  revision: number;
  input: MeetingInput;
  authorization_quote: string;
  reference_at: Date;
  subject: string | null;
  organizer: string | null;
  status: string;
  step: string;
  event_id: string;
  conference_id: string;
  event_url: string | null;
  meet_url: string | null;
  lease_token: string | null;
  attempts: number;
  started_at: Date | null;
  error_code: string | null;
  invite_etag: string | null;
};
const key = (c: MeetingContext) =>
  c.threadId ? 'daily:' + c.threadId : 'root';
const normalized = (text: string) =>
  text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export function validTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
export function meetingTimes(local: string, zone: string, duration: number) {
  const time = Temporal.PlainDateTime.from(local).toZonedDateTime(zone, {
    disambiguation: 'reject',
  });
  return {
    start: time.toInstant().toString(),
    end: time.add({ minutes: duration }).toInstant().toString(),
  };
}
function safeLink(value: string | undefined, meet = false) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (meet
        ? url.hostname === 'meet.google.com'
        : url.hostname === 'calendar.google.com' ||
          (url.hostname === 'www.google.com' &&
            url.pathname.startsWith('/calendar/')))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

@Injectable()
export class Meetings implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(Authority) private readonly authority: Authority,
    @Inject(Calendar) readonly calendar: Calendar,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, 2000);
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  private view(row: MeetingRow) {
    return {
      id: row.id,
      revision: row.revision,
      input: row.input,
      status: row.status,
      step: row.step,
      organizer: row.organizer,
      eventUrl: row.event_url,
      meetUrl: row.meet_url,
      errorCode: row.error_code,
      invitationStatus:
        row.status === 'completed' ? 'accepted_by_google' : null,
    };
  }
  async list(id: string, contextKey?: string) {
    return (
      await this.db.query<MeetingRow>(
        "SELECT * FROM meeting_requests WHERE conversation_id=$1 AND status<>'abandoned' AND ($2::text IS NULL OR context_key=$2) ORDER BY created_at DESC LIMIT 20",
        [id, contextKey ?? null],
      )
    ).rows.map((row) => this.view(row));
  }
  async state(id: string, contextKey?: string) {
    return {
      calendar: await this.calendar.status(id),
      meetings: await this.list(id, contextKey),
    };
  }
  private async assertCurrent(sql: Sql, context: MeetingContext) {
    const c = (
      await sql.query<{
        id: string;
        revision: number;
        owner_tab: string | null;
        owner_epoch: number;
        owner_until: Date | null;
        graduated_at: Date | null;
      }>(
        'SELECT id,revision,owner_tab,owner_epoch,owner_until,graduated_at FROM conversations WHERE id=$1 FOR UPDATE',
        [context.conversationId],
      )
    ).rows[0];
    if (!c?.graduated_at)
      throw new ConflictException('MAIN_EXPERIENCE_REQUIRED');
    if (context.callId) {
      const live = await sql.query(
        "SELECT id FROM calls WHERE id=$1 AND conversation_id=$2 AND generation=$3 AND source_item_id=$4 AND status='active' AND owner_epoch=$5 AND deadline>now()",
        [
          context.callId,
          c.id,
          context.generation,
          context.sourceId,
          c.owner_epoch,
        ],
      );
      const source = await sql.query(
        "SELECT turn_id FROM voice_items WHERE call_id=$1 AND item_id=$2 AND finalized AND role='user'",
        [context.callId, context.sourceId],
      );
      if (
        !live.rows.length ||
        !c.owner_until ||
        new Date(c.owner_until).getTime() <= Date.now()
      )
        throw new ConflictException('STALE_REQUEST');
      if (!source.rows.length)
        throw new ConflictException('TRANSCRIPT_PENDING');
    } else {
      this.authority.assertOwner(c, context.owner);
      if (context.attempt) {
        const valid = context.threadId
          ? await sql.query(
              "SELECT e.id FROM daily_entries e JOIN daily_threads t ON t.id=e.thread_id WHERE e.id=$1 AND e.thread_id=$2 AND t.conversation_id=$3 AND e.attempt=$4 AND e.status='generating' AND e.lease_until>now()",
              [context.sourceId, context.threadId, c.id, context.attempt],
            )
          : await sql.query(
              "SELECT id FROM submissions WHERE id=$1 AND conversation_id=$2 AND attempt=$3 AND status='generating' AND lease_until>now()",
              [context.sourceId, c.id, context.attempt],
            );
        if (!valid.rows.length) throw new ConflictException('STALE_REQUEST');
      }
    }
  }
  async source(context: MeetingContext) {
    if (context.threadId) {
      const rows = (
        await this.db.query<{ id: string; content: string; created_at: Date }>(
          'SELECT e.id,e.content,e.created_at FROM daily_entries e JOIN daily_threads t ON t.id=e.thread_id WHERE t.id=$1 AND t.conversation_id=$2 ORDER BY e.sequence DESC LIMIT 40',
          [context.threadId, context.conversationId],
        )
      ).rows;
      return {
        latest: rows.find((r) => r.id === context.sourceId),
        texts: rows.map((r) => r.content),
      };
    }
    const rows = (
      await this.db.query<{
        id: string;
        content: string;
        created_at: Date;
        submission_id: string;
      }>(
        "SELECT id,content,created_at,submission_id FROM turns WHERE conversation_id=$1 AND role='user' ORDER BY sequence DESC LIMIT 40",
        [context.conversationId],
      )
    ).rows;
    const voice = context.callId
      ? (
          await this.db.query<{ turn_id: string }>(
            'SELECT turn_id FROM voice_items WHERE call_id=$1 AND item_id=$2 AND finalized',
            [context.callId, context.sourceId],
          )
        ).rows[0]
      : null;
    return {
      latest: rows.find((r) =>
        voice ? r.id === voice.turn_id : r.submission_id === context.sourceId,
      ),
      texts: rows.map((r) => r.content),
    };
  }
  async tool(
    context: MeetingContext,
    name: string,
    input: unknown,
  ): Promise<Record<string, unknown>> {
    try {
      if (name === 'get_meeting_status')
        return {
          ...(await this.state(context.conversationId, key(context))),
          now: new Date().toISOString(),
        };
      if (!this.calendar.available())
        return {
          code: 'unavailable',
          message: 'Google Calendar scheduling has not been configured.',
        };
      if (name === 'prepare_meeting') return await this.prepare(context, input);
      if (name === 'execute_meeting') {
        const command = z
          .object({
            draftId: z.string().uuid(),
            expectedRevision: z.number().int(),
          })
          .strict()
          .parse(input);
        return await this.execute(
          context,
          command.draftId,
          command.expectedRevision,
        );
      }
      return { code: 'unknown_tool' };
    } catch (error) {
      return {
        code:
          error instanceof ConflictException
            ? error.message
            : 'INVALID_MEETING',
        message:
          'Check the meeting details and current connection before continuing.',
      };
    }
  }
  private async prepare(context: MeetingContext, input: unknown) {
    const parsed = draftSchema.parse(input);
    const source = await this.source(context);
    if (!source.latest) throw new ConflictException('TRANSCRIPT_PENDING');
    const referenceAt = source.latest.created_at;
    const quote = normalized(parsed.authorizationQuote);
    if (
      !source.texts.some((t) => normalized(t).includes(quote)) ||
      !/\b(schedule|book|arrange|invite|set up|create|send)\b/i.test(quote) ||
      /^(how|what|if|suppose|imagine|example)\b|\b(don't|do not|never)\s+(schedule|book|invite|send)/i.test(
        quote,
      )
    )
      throw new ConflictException('SCHEDULING_INSTRUCTION_REQUIRED');
    const emails = [
      ...new Set(parsed.attendees.map((email) => email.trim().toLowerCase())),
    ];
    if (
      emails.some(
        (email) => !source.texts.some((t) => t.toLowerCase().includes(email)),
      )
    )
      throw new ConflictException('ATTENDEE_ADDRESS_REQUIRED');
    const browser = (
      await this.db.query<{ meeting_timezone: string | null }>(
        'SELECT meeting_timezone FROM conversations WHERE id=$1',
        [context.conversationId],
      )
    ).rows[0]?.meeting_timezone;
    const details: MeetingInput = {
      title: parsed.title,
      description: parsed.description,
      attendees: emails,
      localStart: parsed.localStart,
      timeZone: parsed.timeZone ?? browser ?? null,
      durationMinutes: parsed.durationMinutes,
    };
    const missing = [
      !details.title && 'title or purpose',
      !emails.length && 'attendee email',
      !details.localStart && 'date and time',
      !details.timeZone && 'timezone',
    ].filter(Boolean);
    if (details.timeZone && !validTimeZone(details.timeZone))
      throw new ConflictException('INVALID_TIMEZONE');
    if (details.localStart && details.timeZone) {
      try {
        Object.assign(
          details,
          meetingTimes(
            details.localStart,
            details.timeZone,
            details.durationMinutes,
          ),
        );
      } catch {
        throw new ConflictException('AMBIGUOUS_LOCAL_TIME');
      }
      if (Date.parse(details.start!) <= Date.now())
        throw new ConflictException('MEETING_TIME_PASSED');
    }
    const saved = await this.db.transaction(async (sql) => {
      await this.assertCurrent(sql, context);
      const bySource = (
        await sql.query<MeetingRow>(
          'SELECT * FROM meeting_requests WHERE conversation_id=$1 AND source_key=$2',
          [context.conversationId, context.sourceId],
        )
      ).rows[0];
      if (bySource) return bySource;
      if (parsed.draftId) {
        const existing = (
          await sql.query<MeetingRow>(
            'SELECT * FROM meeting_requests WHERE id=$1 AND conversation_id=$2 AND context_key=$3 FOR UPDATE',
            [parsed.draftId, context.conversationId, key(context)],
          )
        ).rows[0];
        if (!existing || existing.revision !== parsed.expectedRevision)
          throw new ConflictException('STALE_DRAFT');
        if (!['draft', 'connection_required'].includes(existing.status))
          return existing;
        return (
          await sql.query<MeetingRow>(
            "UPDATE meeting_requests SET input=$2,authorization_quote=$3,revision=revision+1,status='draft',updated_at=now() WHERE id=$1 RETURNING *",
            [existing.id, JSON.stringify(details), parsed.authorizationQuote],
          )
        ).rows[0];
      }
      const id = randomUUID();
      return (
        await sql.query<MeetingRow>(
          'INSERT INTO meeting_requests(id,conversation_id,source_key,context_key,input,authorization_quote,reference_at,event_id,conference_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
          [
            id,
            context.conversationId,
            context.sourceId,
            key(context),
            JSON.stringify(details),
            parsed.authorizationQuote,
            referenceAt,
            id.replaceAll('-', ''),
            randomUUID(),
          ],
        )
      ).rows[0];
    });
    return {
      code: missing.length ? 'needs_details' : 'prepared',
      missing,
      meeting: this.view(saved),
    };
  }
  async execute(context: MeetingContext, id: string, revision: number) {
    return this.db.transaction(async (sql) => {
      await this.assertCurrent(sql, context);
      const row = (
        await sql.query<MeetingRow>(
          'SELECT * FROM meeting_requests WHERE id=$1 AND conversation_id=$2 FOR UPDATE',
          [id, context.conversationId],
        )
      ).rows[0];
      if (!row || row.revision !== revision)
        throw new ConflictException('STALE_DRAFT');
      if (!['draft', 'connection_required'].includes(row.status))
        return { code: row.status, meeting: this.view(row) };
      const i = row.input;
      if (!i.title || !i.attendees.length || !i.start || !i.end || !i.timeZone)
        return { code: 'needs_details', meeting: this.view(row) };
      if (Date.parse(i.start) <= Date.now())
        throw new ConflictException('MEETING_TIME_PASSED');
      const connection = (
        await sql.query<{ subject: string; email: string; status: string }>(
          'SELECT subject,email,status FROM calendar_connections WHERE conversation_id=$1',
          [context.conversationId],
        )
      ).rows[0];
      if (row.subject && connection && row.subject !== connection.subject)
        throw new ConflictException('ACCOUNT_MISMATCH');
      if (!connection || connection.status !== 'connected') {
        await sql.query(
          "UPDATE meeting_requests SET status='connection_required' WHERE id=$1",
          [id],
        );
        return {
          code: 'connection_required',
          meeting: this.view({ ...row, status: 'connection_required' }),
        };
      }
      if (i.attendees.includes(connection.email.toLowerCase()))
        throw new ConflictException('INVITE_OTHER_ATTENDEE');
      const updated = (
        await sql.query<MeetingRow>(
          "UPDATE meeting_requests SET status='queued',subject=$2,organizer=$3,started_at=now(),next_at=now(),updated_at=now() WHERE id=$1 RETURNING *",
          [id, connection.subject, connection.email],
        )
      ).rows[0];
      return { code: 'accepted', meeting: this.view(updated) };
    });
  }
  async resume(context: MeetingContext, id: string) {
    await this.db.transaction(async (sql) => {
      await this.assertCurrent(sql, context);
      const row = (
        await sql.query<MeetingRow>(
          'SELECT * FROM meeting_requests WHERE id=$1 AND conversation_id=$2 FOR UPDATE',
          [id, context.conversationId],
        )
      ).rows[0];
      if (!row) throw new ConflictException('MEETING_NOT_FOUND');
      if (!['attention_required', 'reconnect_needed'].includes(row.status))
        return;
      await sql.query(
        "UPDATE meeting_requests SET status='queued',attempts=0,started_at=now(),next_at=now(),error_code=NULL WHERE id=$1",
        [id],
      );
    });
    return this.state(context.conversationId);
  }
  async dismiss(context: MeetingContext, id: string) {
    await this.db.transaction(async (sql) => {
      await this.assertCurrent(sql, context);
      const result = await sql.query(
        "UPDATE meeting_requests SET status='abandoned',updated_at=now() WHERE id=$1 AND conversation_id=$2 AND status IN ('draft','connection_required','attention_required','reconnect_needed') AND (lease_until IS NULL OR lease_until<now()) RETURNING id",
        [id, context.conversationId],
      );
      if (!result.rows.length)
        throw new ConflictException('MEETING_IN_PROGRESS');
    });
    return this.state(context.conversationId);
  }
  private async save(
    row: MeetingRow,
    values: {
      step?: string;
      status?: string;
      eventUrl?: string | null;
      meetUrl?: string | null;
      error?: string | null;
      delay?: number;
      etag?: string | null;
    },
  ) {
    await this.db.query(
      `UPDATE meeting_requests SET step=COALESCE($3,step),status=$4,event_url=COALESCE($5,event_url),meet_url=COALESCE($6,meet_url),error_code=$7,
      invite_etag=COALESCE($8,invite_etag),lease_token=NULL,lease_until=NULL,next_at=now()+($9 * interval '1 second'),updated_at=now() WHERE id=$1 AND lease_token=$2`,
      [
        row.id,
        row.lease_token,
        values.step ?? null,
        values.status ?? 'queued',
        values.eventUrl ?? null,
        values.meetUrl ?? null,
        values.error ?? null,
        values.etag ?? null,
        values.delay ?? 1,
      ],
    );
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const row = await this.db.transaction(async (sql) => {
        const candidate = (
          await sql.query<{ id: string; conversation_id: string }>(
            "SELECT id,conversation_id FROM meeting_requests WHERE status IN ('queued','running') AND next_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_at LIMIT 1",
          )
        ).rows[0];
        if (!candidate) return undefined;
        await sql.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE', [
          candidate.conversation_id,
        ]);
        return (
          await sql.query<MeetingRow>(
            "UPDATE meeting_requests SET status='running',lease_token=$2,lease_until=now()+interval '60 seconds' WHERE id=$1 AND status IN ('queued','running') AND (lease_until IS NULL OR lease_until<now()) RETURNING *",
            [candidate.id, randomUUID()],
          )
        ).rows[0];
      });
      if (row) await this.run(row);
    } finally {
      this.ticking = false;
    }
  }
  private matches(row: MeetingRow, event: CalendarEvent) {
    return (
      event.status !== 'cancelled' &&
      event.extendedProperties?.private?.personaOperation === row.id &&
      event.summary === row.input.title &&
      (event.description ?? '') === (row.input.description ?? '') &&
      (!row.meet_url ||
        event.conferenceData?.entryPoints?.some(
          (point) =>
            point.entryPointType === 'video' && point.uri === row.meet_url,
        )) &&
      Date.parse(event.start?.dateTime ?? '') ===
        Date.parse(row.input.start!) &&
      Date.parse(event.end?.dateTime ?? '') === Date.parse(row.input.end!)
    );
  }
  private async run(row: MeetingRow) {
    try {
      const credentials = await this.calendar.credentials(
        row.conversation_id,
        row.subject,
      );
      const provider = this.calendar.provider;
      let event: CalendarEvent | undefined;
      try {
        event = await provider.getEvent(credentials.token, row.event_id);
      } catch (error) {
        if (!(
          error instanceof CalendarError &&
          error.status === 404 &&
          row.step === 'creating_event'
        ))
          throw error;
      }
      if (!event) {
        if (Date.parse(row.input.start!) <= Date.now())
          throw new CalendarError('MEETING_TIME_PASSED');
        event = await provider.insertEvent(credentials.token, {
          id: row.event_id,
          summary: row.input.title,
          description: row.input.description ?? '',
          start: { dateTime: row.input.start, timeZone: row.input.timeZone },
          end: { dateTime: row.input.end, timeZone: row.input.timeZone },
          extendedProperties: {
            private: {
              personaOperation: row.id,
              requestHash: createHash('sha256')
                .update(JSON.stringify(row.input))
                .digest('hex'),
            },
          },
          conferenceData: {
            createRequest: {
              requestId: row.conference_id,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        });
      }
      if (!this.matches(row, event)) throw new CalendarError('EVENT_CHANGED');
      const eventUrl = safeLink(event.htmlLink);
      const meetUrl = safeLink(
        event.conferenceData?.entryPoints?.find(
          (p) => p.entryPointType === 'video',
        )?.uri,
        true,
      );
      if (
        event.conferenceData?.createRequest?.status?.statusCode === 'failure'
      ) {
        await this.save(row, {
          status: 'attention_required',
          eventUrl,
          error: 'MEET_CREATION_FAILED',
        });
        return;
      }
      if (!meetUrl) {
        const expired =
          Date.now() - new Date(row.started_at!).getTime() > 120000;
        await this.save(row, {
          step: 'waiting_for_meet',
          eventUrl,
          status: expired ? 'attention_required' : 'queued',
          error: expired ? 'MEET_PENDING' : null,
          delay: 4,
        });
        return;
      }
      const marker = event.extendedProperties?.private?.personaInvited;
      const expected = row.input.attendees
        .map((e) => e.toLowerCase())
        .sort()
        .join(',');
      const actual =
        event.attendees
          ?.map((e) => e.email.toLowerCase())
          .sort()
          .join(',') ?? '';
      if (marker === row.id && actual === expected) {
        await this.save(row, {
          status: 'completed',
          step: 'completed',
          eventUrl,
          meetUrl,
        });
        return;
      }
      if (
        marker ||
        actual ||
        (row.invite_etag && row.invite_etag !== event.etag)
      )
        throw new CalendarError('EVENT_CHANGED');
      if (Date.parse(row.input.start!) <= Date.now())
        throw new CalendarError('MEETING_TIME_PASSED');
      // Persist the exact conditional version before the externally visible send.
      const saved = await this.db.query(
        "UPDATE meeting_requests SET step='sending_invites',invite_etag=$3,event_url=$4,meet_url=$5 WHERE id=$1 AND lease_token=$2 RETURNING id",
        [row.id, row.lease_token, event.etag, eventUrl, meetUrl],
      );
      if (!saved.rows.length) return;
      row.step = 'sending_invites';
      row.invite_etag = event.etag;
      const updated = await provider.invite(credentials.token, event, {
        summary: event.summary,
        description: event.description ?? '',
        start: event.start,
        end: event.end,
        conferenceData: event.conferenceData,
        attendees: row.input.attendees.map((email) => ({ email })),
        extendedProperties: {
          ...event.extendedProperties,
          private: {
            ...event.extendedProperties?.private,
            personaInvited: row.id,
          },
        },
      });
      if (
        !this.matches(row, updated) ||
        updated.extendedProperties?.private?.personaInvited !== row.id
      )
        throw new CalendarError('UNVERIFIED_RESULT');
      await this.save(row, {
        status: 'completed',
        step: 'completed',
        eventUrl,
        meetUrl,
      });
    } catch (error) {
      const code =
        error instanceof CalendarError ? error.code : 'GOOGLE_UNAVAILABLE';
      if (code === 'RECONNECT_REQUIRED') {
        await this.calendar.reconnect(row.conversation_id, row.subject);
        await this.save(row, { status: 'reconnect_needed', error: code });
        return;
      }
      const retry = [
        'GOOGLE_UNAVAILABLE',
        'TOKEN_UNAVAILABLE',
        'RATE_LIMIT',
        'EVENT_EXISTS',
        'EVENT_CHANGED',
      ].includes(code);
      const exhausted =
        row.attempts >= 4 ||
        Date.now() - new Date(row.started_at!).getTime() > 120000;
      await this.db.query(
        'UPDATE meeting_requests SET attempts=attempts+1 WHERE id=$1 AND lease_token=$2',
        [row.id, row.lease_token],
      );
      await this.save(row, {
        status: retry && !exhausted ? 'queued' : 'attention_required',
        error: code,
        delay: Math.max(
          Math.min(2 ** row.attempts + Math.random(), 30),
          error instanceof CalendarError ? Math.min(error.retryAfter, 120) : 0,
        ),
      });
    }
  }
}
