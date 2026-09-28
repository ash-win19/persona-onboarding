import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3001);
}
// Don't await at the top level: Vercel's runtime waits for this module to
// finish loading, and on Vercel app.listen() never resolves.
void bootstrap();
