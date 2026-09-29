import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CHAT_CONFIG, type ChatConfig } from './config.js';
import { ChatErrors, credential, owner } from './chat.controller.js';
import { uuid } from './authority.js';
import { Gmail } from './gmail.js';
import { Calls } from './calls.js';
@Controller('gmail')
@UseFilters(ChatErrors)
export class GmailController {
  constructor(
    @Inject(Gmail) private readonly gmail: Gmail,
    @Inject(CHAT_CONFIG) private readonly config: ChatConfig,
    @Inject(Calls) private readonly calls: Calls,
  ) {}
  private write(req: Request) {
    if (
      !this.config.origins.includes(req.headers.origin ?? '') ||
      req.headers['x-persona-client'] !== 'web'
    )
      throw new ForbiddenException();
    if (!req.is('application/json')) throw new BadRequestException();
    const control = owner(req);
    if (!control) throw new ForbiddenException();
    return control;
  }
  @Get('status')
  status(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    return this.gmail.status(credential(req));
  }
  @Post('start')
  @HttpCode(200)
  start(@Req() req: Request) {
    return this.gmail.start(credential(req), this.write(req));
  }
  @Post('cancel')
  @HttpCode(200)
  cancel(@Req() req: Request, @Body() body: unknown) {
    const control = this.write(req);
    if (!body || typeof body !== 'object' || !('id' in body) || !uuid(body.id))
      throw new BadRequestException();
    return this.gmail.cancel(credential(req), control, body.id);
  }
  @Get('callback')
  async callback(
    @Req() req: Request,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ) {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    const { state, code, error } = query;
    if (
      typeof state !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(state) ||
      (code !== undefined &&
        (typeof code !== 'string' || code.length > 4096)) ||
      (error !== undefined && (typeof error !== 'string' || error.length > 200))
    )
      throw new BadRequestException();
    const result = await this.gmail.callback(
      credential(req),
      state,
      code as string | undefined,
      error as string | undefined,
    );
    if (result === 'connected')
      await this.calls.refreshContext(credential(req)).catch(() => undefined);
    res.redirect(
      303,
      this.config.origins[0] + '/?gmail=' + encodeURIComponent(result),
    );
  }
}
