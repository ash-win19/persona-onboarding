export const CHAT_CONFIG = Symbol('CHAT_CONFIG');
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
