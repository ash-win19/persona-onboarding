export const CHAT_CONFIG = Symbol('CHAT_CONFIG');
export const DEFAULT_MODEL = 'gpt-6-luna';
export type ReasoningEffort = 'none' | 'low';
// Reasoning models default to medium effort, which adds latency and spends the
// output caps on reasoning. Fact capture uses low; plain writing uses none.
// gpt-4.1 and gpt-4o models reject the field.
export function usesReasoning(model: string) {
  return /^(gpt-[5-9]|o\d)/.test(model);
}
export function reasoningFor(model: string, effort: ReasoningEffort) {
  return usesReasoning(model) ? { reasoning: { effort } } : {};
}
export interface ChatConfig {
  origins: string[];
  secureCookies: boolean;
}
export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
}
export function chatConfig(): ChatConfig {
  const origins = required('APP_ORIGINS')
    .split(',')
    .map((value) => new URL(value.trim()).origin);
  return { origins, secureCookies: process.env.NODE_ENV === 'production' };
}
