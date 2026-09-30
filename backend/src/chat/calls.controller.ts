import { browserWrite } from './http-policy.js';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CHAT_CONFIG, type ChatConfig } from './config.js';
import { ChatErrors, credential } from './chat.controller.js';
import { uuid } from './authority.js';
import { Calls } from './calls.js';

@Controller('calls')
@UseFilters(ChatErrors)
export class CallsController {
  constructor(
    @Inject(Calls) private readonly calls: Calls,
    @Inject(CHAT_CONFIG) private readonly config: ChatConfig,
  ) {}
  @Get('status')
  status(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    return this.calls.status(credential(req));
  }
  @Post('start')
  @HttpCode(200)
  start(@Req() req: Request, @Body() body: unknown) {
    const controller = browserWrite(req, this.config, true);
    if (
      !body ||
      typeof body !== 'object' ||
      !('id' in body) ||
      !uuid(body.id) ||
      !('sdp' in body) ||
      typeof body.sdp !== 'string' ||
      !body.sdp.startsWith('v=0') ||
      body.sdp.length > 64000
    )
      throw new BadRequestException();
    return this.calls.start(credential(req), controller, body.id, body.sdp);
  }
  @Post('turns')
  @HttpCode(200)
  type(@Req() req: Request, @Body() body: unknown) {
    const controller = browserWrite(req, this.config, true);
    if (
      !body ||
      typeof body !== 'object' ||
      !('id' in body) ||
      !uuid(body.id) ||
      !('submissionId' in body) ||
      !uuid(body.submissionId) ||
      !('content' in body) ||
      typeof body.content !== 'string' ||
      !body.content.trim() ||
      body.content.length > 8000
    )
      throw new BadRequestException();
    return this.calls.type(
      credential(req),
      controller,
      body.id,
      body.submissionId,
      body.content.trim(),
    );
  }
  @Post('preferences')
  @HttpCode(200)
  preferences(@Req() req: Request, @Body() body: unknown) {
    const owner = browserWrite(req, this.config, true);
    if (
      !body ||
      typeof body !== 'object' ||
      !('id' in body) ||
      !uuid(body.id) ||
      !('revision' in body) ||
      typeof body.revision !== 'number' ||
      !Number.isSafeInteger(body.revision) ||
      body.revision < 1 ||
      body.revision > 2147483647 ||
      !('microphoneEnabled' in body) ||
      typeof body.microphoneEnabled !== 'boolean' ||
      !('replyMode' in body) ||
      !['audio', 'text'].includes(String(body.replyMode))
    )
      throw new BadRequestException();
    return this.calls.preferences(
      credential(req),
      owner,
      body.id,
      body.revision,
      body.microphoneEnabled,
      body.replyMode === 'text' ? 'text' : 'audio',
    );
  }

  @Post('retry-onboarding')
  @HttpCode(200)
  async retryOnboarding(@Req() req: Request) {
    const controller = browserWrite(req, this.config, true);
    await this.calls.retryOnboarding(credential(req), controller);
    return { accepted: true };
  }
  @Post('ready')
  @HttpCode(200)
  ready(@Req() req: Request, @Body() body: unknown) {
    const controller = browserWrite(req, this.config, true);
    if (!body || typeof body !== 'object' || !('id' in body) || !uuid(body.id))
      throw new BadRequestException();
    return this.calls.ready(credential(req), controller, body.id);
  }
  @Post('end')
  @HttpCode(200)
  end(@Req() req: Request, @Body() body: unknown) {
    const controller = browserWrite(req, this.config, true);
    if (
      !body ||
      typeof body !== 'object' ||
      !('id' in body) ||
      !uuid(body.id) ||
      !('reason' in body) ||
      typeof body.reason !== 'string' ||
      !['user_hangup', 'page_exit', 'connection_lost'].includes(body.reason)
    )
      throw new BadRequestException();
    return this.calls.end(credential(req), controller, body.id, body.reason);
  }
}
