import { Inject, Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { DEFAULT_MODEL, reasoningFor } from './config.js';
import { DATABASE, type Database } from './database.js';
import { Meetings, type MeetingContext } from './meetings.js';
import {
  meetingInstructions,
  meetingReference,
  meetingTools,
} from './meeting-tools.js';
import type { ModelTurn } from './model.js';

@Injectable()
export class MeetingAssistant {
  private readonly client = process.env.OPENAI_API_KEY
    ? new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        maxRetries: 0,
        timeout: 30000,
      })
    : null;
  constructor(
    @Inject(Meetings) private readonly meetings: Meetings,
    @Inject(DATABASE) private readonly db: Database,
  ) {}
  async reply(
    context: MeetingContext,
    turns: ModelTurn[],
  ): Promise<string | null> {
    if (!this.meetings.calendar.enabled()) return null;
    const latest = turns.filter((t) => t.role === 'user').at(-1)?.content ?? '';
    const state = await this.meetings.state(
      context.conversationId,
      context.threadId ? 'daily:' + context.threadId : 'root',
    );
    const pending = state.meetings.some((m) =>
      ['draft', 'connection_required'].includes(m.status),
    );
    if (
      !pending &&
      !(
        state.meetings.length &&
        /\b(it|that|link|done|status|again|retry|when|change|cancel|resend)\b/i.test(
          latest,
        )
      ) &&
      !/\b(google meet|meeting|calendar|invitation|invite|schedule|appointment)\b/i.test(
        latest,
      )
    )
      return null;
    if (!state.calendar.available)
      return 'Google Calendar scheduling is not configured yet. Once it is enabled, I can create a Google Meet and have Calendar email the invitations.';
    if (!this.client) throw new Error('MEETING_MODEL_UNAVAILABLE');
    const source = await this.meetings.source(context);
    const zone = (
      await this.db.query<{ meeting_timezone: string | null }>(
        'SELECT meeting_timezone FROM conversations WHERE id=$1',
        [context.conversationId],
      )
    ).rows[0]?.meeting_timezone;
    const input: OpenAI.Responses.ResponseInput = turns
      .slice(-30)
      .map(({ role, content }) => ({ role, content }));
    const signal = AbortSignal.timeout(60000);
    const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
    for (let i = 0; i < 4; i++) {
      const response = await this.client.responses.create(
        {
          model,
          ...reasoningFor(model, 'low'),
          store: false,
          max_output_tokens: 1600,
          instructions:
            meetingInstructions +
            '\nAnswer concisely. Current server state: ' +
            JSON.stringify(state) +
            '\nReference clock: ' +
            JSON.stringify(
              meetingReference(source.latest?.created_at ?? Date.now(), zone),
            ),
          input,
          tools: meetingTools,
          parallel_tool_calls: false,
        },
        { signal },
      );
      if (response.status !== 'completed')
        throw new Error('MEETING_REPLY_INCOMPLETE');
      const calls = response.output.filter(
        (item) => item.type === 'function_call',
      );
      if (!calls.length)
        return (
          response.output_text.trim() ||
          'The current meeting status is shown below.'
        );
      input.push(
        ...response.output.filter(
          (item) => item.type === 'function_call' || item.type === 'reasoning',
        ),
      );
      for (const call of calls) {
        let args: unknown;
        try {
          args = JSON.parse(call.arguments);
        } catch {
          args = null;
        }
        const result = await this.meetings.tool(context, call.name, args);
        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
        if (result.code === 'accepted')
          return 'I’m creating the Google Meet and asking Google Calendar to email the invitations. The meeting card will show the links when it’s ready.';
        if (result.code === 'connection_required')
          return 'Your meeting details are saved. Use Connect Google Calendar below; I’ll continue this request once it is connected.';
      }
    }
    return 'Your meeting details are saved. Check the meeting card for the current status.';
  }
}
