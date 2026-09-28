import { OnboardingService } from './onboarding.js';
import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { DATABASE, PostgresDatabase } from './database.js';
import { CHAT_CONFIG, chatConfig, required } from './config.js';
import { MODEL, OpenAIReplyModel } from './model.js';

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    OnboardingService,
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
