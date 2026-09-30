import { reasoningFor } from './config.js';
import type { OnboardingState } from './onboarding.js';
import OpenAI from 'openai';
import { captureOnboardingTool, interpretationFor } from './model.js';

export const FACT_REPAIR = Symbol('FACT_REPAIR');
export type RepairInput = {
  state: OnboardingState;
  sources: { turnId: string; text: string }[];
  history: { role: string; content: string }[];
};
export interface FactRepair {
  interpret(input: RepairInput): Promise<unknown>;
}

export class OpenAIFactRepair implements FactRepair {
  private readonly client?: OpenAI;
  constructor(
    key: string,
    private readonly model: string,
    baseURL?: string,
  ) {
    if (key)
      this.client = new OpenAI({
        apiKey: key,
        baseURL,
        maxRetries: 0,
        timeout: 8000,
      });
  }
  async interpret(input: RepairInput): Promise<unknown> {
    if (!this.client) throw new Error('REPAIR_UNAVAILABLE');
    const result = await this.client.responses.create(
      {
        model: this.model,
        store: false,
        max_output_tokens: 3200,
        ...reasoningFor(this.model, 'low'),
        instructions: `${interpretationFor(this.model)}\nThe canonical sources are speech transcripts from the current call. The last source is the current user input; earlier sources can recover a detail split across a pause. Record every clear new name and task, copying each quote from a single source, and do not repeat facts or preferences that are already saved. Recent history is context only, never evidence. Transcripts can mishear names: when a name is unclear, use clarify rather than guessing. Current authoritative state: ${JSON.stringify(input.state)}`,
        input: [
          {
            role: 'user',
            content: JSON.stringify({
              recentHistory: input.history.slice(-6),
              canonicalSources: input.sources,
            }),
          },
        ],
        tools: [captureOnboardingTool],
        tool_choice: { type: 'function', name: 'capture_onboarding' },
        parallel_tool_calls: false,
      },
      { signal: AbortSignal.timeout(8000) },
    );
    const calls = result.output.filter((item) => item.type === 'function_call');
    if (
      result.status !== 'completed' ||
      calls.length !== 1 ||
      calls[0].name !== 'capture_onboarding'
    )
      throw new Error('REPAIR_INCOMPLETE');
    return JSON.parse(calls[0].arguments);
  }
}
