import type { OnboardingState } from './onboarding.js';
import OpenAI from 'openai';
import { captureOnboardingTool, interpretation } from './model.js';

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
        max_output_tokens: 1800,
        instructions: `${interpretation}\nThis is a rejected voice proposal retry. The canonical sources are adjacent unassessed parts of the latest spoken answer. Interpret ALL clear facts across those sources, and copy evidence from one source per change. The recent history is context only, never evidence for new facts. Include preferences ONLY for choices explicitly expressed in those sources; never fill missing goals or infer preferences from saved state. Names and tasks alone are changes, not preference updates. Include memory ONLY for details explicitly stated in those sources. Use an empty preferences array when no explicit refusal, deferral, or reopening was spoken. Do not invent punctuation or extra words. Preserve an explicit global exit request in exitEvidence with an exact canonical quote; otherwise use null. Never ask for an agent name during voice. Current authoritative state: ${JSON.stringify(input.state)}`,
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
