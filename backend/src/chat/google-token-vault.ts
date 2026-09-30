import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function sealGoogleToken(keyValue: string, value: unknown) {
  const key = Buffer.from(keyValue, 'base64');
  if (key.length !== 32) throw new Error('GOOGLE_ENCRYPTION_UNAVAILABLE');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function openGoogleToken<T>(keyValue: string, value: string): T {
  const bytes = Buffer.from(value, 'base64');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyValue, 'base64'),
    bytes.subarray(0, 12),
  );
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString('utf8'),
  ) as T;
}
