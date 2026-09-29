import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
import { ChatErrors, credential, owner } from './chat.controller.js';
import { uuid } from './authority.js';
import { Calls } from './calls.js';

@Controller('calls')
@UseFilters(ChatErrors)
export class CallsController {
  constructor(
    @Inject(Calls) private readonly calls: Calls,
    @Inject(CHAT_CONFIG) private readonly config: ChatConfig,
  ) {}
  private access(req: Request) {
    if (
      !this.config.origins.includes(req.headers.origin ?? '') ||
      req.headers['x-persona-client'] !== 'web'
    )
      throw new ForbiddenException();
    if (!req.is('application/json')) throw new BadRequestException();
    const controller = owner(req);
    if (!controller) throw new ForbiddenException();
    return controller;
  }
  @Get('status')
  status(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    return this.calls.status(credential(req));
  }
  @Post('start')
  @HttpCode(200)
  start(@Req() req: Request, @Body() body: unknown) {
    const controller = this.access(req);
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
  @Post('end')
  @HttpCode(200)
  end(@Req() req: Request, @Body() body: unknown) {
    const controller = this.access(req);
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
