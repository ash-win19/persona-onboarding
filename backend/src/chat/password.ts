import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });

export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 256)
    throw new Error('Use a password between 12 and 256 characters.');
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1:${salt}:${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, encoded?: string) {
  const [version, salt, hash] = (encoded ?? '').split(':');
  const valid =
    version === 'scrypt-v1' &&
    /^[a-f0-9]{32}$/.test(salt ?? '') &&
    /^[a-f0-9]{128}$/.test(hash ?? '');
  // Unknown accounts still perform the same expensive password derivation.
  const key = await derive(
    password,
    valid ? salt : '00000000000000000000000000000000',
  );
  return valid && timingSafeEqual(key, Buffer.from(hash, 'hex'));
}
