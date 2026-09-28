import OpenAI from 'openai';

export const MODEL = Symbol('MODEL');
export interface ModelTurn {
  role: 'user' | 'assistant';
  content: string;
}
export interface ReplyModel {
  reply(turns: ModelTurn[]): Promise<string>;
}
export class OpenAIReplyModel implements ReplyModel {
  private readonly client: OpenAI;
  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey, maxRetries: 0, timeout: 40000 });
  }
  async reply(turns: ModelTurn[]): Promise<string> {
    const result = await this.client.responses.create({
      model: this.model,
      store: false,
      max_output_tokens: 1200,
      instructions:
        'You are Persona, a thoughtful personal assistant. Help with the current request directly. Keep replies concise and conversational. Ask one focused question when needed. You can draft, explain, and plan in this chat. You do not have email access, calling, browsing, or external action tools. Never claim to have performed actions outside this conversation.',
      input: turns,
    });
    if (result.status !== 'completed' || !result.output_text.trim())
      throw new Error('MODEL_INCOMPLETE');
    return result.output_text.trim();
  }
}
