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
import { DATABASE, PostgresDatabase } from './database.js';
import { CHAT_CONFIG, chatConfig, required } from './config.js';
import { MODEL, OpenAIReplyModel } from './model.js';

@Module({
  controllers: [
    ChatController,
    CallsController,
    GmailController,
    ResetController,
  ],
  providers: [
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
