import { Workspace } from './workspace.js';
import { WorkspaceController } from './workspace.controller.js';
import { DAILY_MODEL, OpenAIDailyModel } from './daily-model.js';
import { Reset } from './reset.js';
import { ResetController } from './reset.controller.js';
import { Diagnostics } from './diagnostics.js';
import { Gmail, TOKEN_KEY } from './gmail.js';
import { GmailController } from './gmail.controller.js';
import { GMAIL_PROVIDER, GoogleGmailProvider } from './gmail-provider.js';
import { OnboardingPolicy } from './onboarding-policy.js';
import { OnboardingService } from './onboarding.js';
import { Authority, CLOCK } from './authority.js';
import { Calls } from './calls.js';
import { CallsController } from './calls.controller.js';
import { OpenAIVoiceProvider, VOICE_PROVIDER } from './voice-provider.js';
import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { DATABASE, PostgresDatabase, type Database } from './database.js';
import { CHAT_CONFIG, chatConfig, required } from './config.js';
import { MODEL, OpenAIReplyModel } from './model.js';
import { FACT_REPAIR, OpenAIFactRepair } from './fact-repair.js';
import { CALL_RECAP, OpenAICallRecap } from './call-recap.js';
import { Accounts } from './accounts.js';
import { AccountsController } from './accounts.controller.js';
import { CONVERSATION_MEMORY, createConversationMemory } from './memory.js';

@Module({
  controllers: [
    WorkspaceController,
    AccountsController,
    ChatController,
    CallsController,
    GmailController,
    ResetController,
  ],
  providers: [
    Workspace,
    {
      provide: DAILY_MODEL,
      useFactory: () =>
        new OpenAIDailyModel(
          process.env.OPENAI_API_KEY ?? '',
          process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        ),
    },
    Accounts,
    {
      provide: FACT_REPAIR,
      useFactory: () =>
        new OpenAIFactRepair(
          process.env.OPENAI_API_KEY ?? '',
          process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        ),
    },
    {
      provide: CALL_RECAP,
      useFactory: () =>
        new OpenAICallRecap(
          process.env.OPENAI_API_KEY ?? '',
          process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        ),
    },
    ChatService,
    Gmail,
    Reset,
    Diagnostics,
    { provide: TOKEN_KEY, useFactory: () => process.env.GMAIL_TOKEN_KEY ?? '' },
    {
      provide: GMAIL_PROVIDER,
      useFactory: () =>
        new GoogleGmailProvider(
          process.env.GOOGLE_CLIENT_ID ?? '',
          process.env.GOOGLE_CLIENT_SECRET ?? '',
          process.env.GOOGLE_REDIRECT_URI ?? '',
        ),
    },
    OnboardingService,
    OnboardingPolicy,
    Authority,
    Calls,
    {
      provide: VOICE_PROVIDER,
      useFactory: () =>
        new OpenAIVoiceProvider(
          process.env.OPENAI_API_KEY ?? '',
          process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-mini',
        ),
    },
    {
      provide: CONVERSATION_MEMORY,
      useFactory: (db: Database) => createConversationMemory(db),
      inject: [DATABASE],
    },
    { provide: CLOCK, useValue: () => Date.now() },
    { provide: CHAT_CONFIG, useFactory: chatConfig },
    {
      provide: DATABASE,
      useFactory: () => new PostgresDatabase(required('DATABASE_URL')),
    },
    {
      provide: MODEL,
      useFactory: () =>
        new OpenAIReplyModel(
          required('OPENAI_API_KEY'),
          process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        ),
    },
  ],
})
export class ChatModule {}
