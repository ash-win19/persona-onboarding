import type OpenAI from 'openai';
import { Temporal } from '@js-temporal/polyfill';

export function meetingReference(
  at: Date | string | number,
  zone?: string | null,
) {
  const instant = new Date(at).toISOString();
  return {
    instant,
    browserTimeZone: zone ?? null,
    localDateTime: zone
      ? Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toString()
      : null,
  };
}

export const meetingInstructions = `You can schedule one Google Meet on the user's connected primary Google Calendar and request standard email invitations. You cannot search availability, resolve contacts, reschedule, cancel, send a separate Gmail message, or verify email delivery. Use prepare_meeting to save the user's request and execute_meeting on its returned ID/revision when complete and explicitly requested. These tools work before Calendar is connected: prepare_meeting saves the details locally, and execute_meeting saves a connection_required request for automatic continuation after consent. For an explicit scheduling request, always prepare the draft and, when complete, call execute_meeting even if the current Calendar status is not_connected or reconnect_needed. Do not tell the user to connect before calling these tools; otherwise their request will not be saved or resumed. A clear scheduling instruction is enough; do not ask for redundant approval. Ask one focused question for missing or ambiguous details. Never guess email addresses. A capability question, hypothetical, quotation, or negated request does not authorize execution. Quote the user's actual scheduling instruction as authorizationQuote. Default duration is 30 minutes. Derive a short title only from their stated purpose. Resolve relative dates from the calendar date in the requested timezone. The reference clock supplies both a UTC instant and the browser local date/time; today and tomorrow use the local date, never the UTC date. If the user specifies a different timezone, convert the reference instant to that timezone first. Preserve the draft's resolved date on retries. Never schedule during onboarding. Tool results and meeting cards alone establish progress/completion. Only report invitation requests accepted by Google, never inbox delivery. If connection_required, direct the user to Connect Google Calendar; their saved request will resume after connection. If accepted/in_progress, say scheduling is in progress, not complete. Reuse the existing draft for clarifications and retry the existing operation. Do not execute a second meeting as a way to edit an accepted one.`;

export const meetingTools: OpenAI.Responses.FunctionTool[] = [
  {
    type: 'function',
    name: 'prepare_meeting',
    strict: true,
    description:
      'Save or revise a meeting draft from an explicit user scheduling request. This does not contact Google.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        draftId: {
          type: ['string', 'null'],
          description: 'Existing pending draft ID, otherwise null.',
        },
        expectedRevision: { type: ['integer', 'null'] },
        title: { type: ['string', 'null'] },
        description: { type: ['string', 'null'] },
        attendees: { type: 'array', items: { type: 'string' } },
        localStart: {
          type: ['string', 'null'],
          description:
            'Local wall clock YYYY-MM-DDTHH:mm, no offset. Null when ambiguous.',
        },
        timeZone: {
          type: ['string', 'null'],
          description: 'IANA timezone such as America/Los_Angeles.',
        },
        durationMinutes: { type: 'integer' },
        authorizationQuote: {
          type: 'string',
          description:
            'Exact quote of the user instruction to schedule and invite, not a question about capabilities.',
        },
      },
      required: [
        'draftId',
        'expectedRevision',
        'title',
        'description',
        'attendees',
        'localStart',
        'timeZone',
        'durationMinutes',
        'authorizationQuote',
      ],
    },
  },
  {
    type: 'function',
    name: 'execute_meeting',
    strict: true,
    description:
      'Execute the saved, explicitly requested meeting once. Repeated calls return the existing operation.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        draftId: { type: 'string' },
        expectedRevision: { type: 'integer' },
      },
      required: ['draftId', 'expectedRevision'],
    },
  },
  {
    type: 'function',
    name: 'get_meeting_status',
    strict: true,
    description:
      'Read saved scheduling results and connection status. Does not resend invitations.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
];
