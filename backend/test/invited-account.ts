import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createAccount } from '../src/chat/account-admin.js';
import { DATABASE } from '../src/chat/database.js';

export async function invitedAccount(app: INestApplication) {
  const credentials = {
    email: `${randomUUID()}@example.test`,
    password: 'test-account-password',
  };
  await createAccount(
    app.get(DATABASE),
    credentials.email,
    credentials.password,
  );
  return credentials;
}
