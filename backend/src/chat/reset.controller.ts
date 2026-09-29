import { browserWrite } from './http-policy.js';
import {
  BadRequestException,
  Body,
  Controller,
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
import { Reset } from './reset.js';
@Controller('reset')
@UseFilters(ChatErrors)
export class ResetController {
  constructor(
    @Inject(Reset) private readonly reset: Reset,
    @Inject(CHAT_CONFIG) private readonly config: ChatConfig,
  ) {}
  @Post()
  @HttpCode(200)
  async start(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const control = browserWrite(req, this.config, true);
    if (
      !body ||
      typeof body !== 'object' ||
      !('operationId' in body) ||
      !uuid(body.operationId)
    )
      throw new BadRequestException();
    const result = await this.reset.start(
      credential(req),
      control,
      body.operationId,
    );
    res.set('Cache-Control', 'no-store');
    res.cookie('persona_session', result.credential, {
      httpOnly: true,
      secure: this.config.secureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: 180 * 86400 * 1000,
    });
    return result.snapshot;
  }
}
