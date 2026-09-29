import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseFilters,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Accounts, SESSION_AGE } from './accounts.js';
import { CHAT_CONFIG, type ChatConfig } from './config.js';
import { ChatErrors, credential } from './chat.controller.js';
import { browserWrite } from './http-policy.js';

@Controller('auth')
@UseFilters(ChatErrors)
export class AccountsController {
  constructor(
    @Inject(Accounts) private readonly accounts: Accounts,
    @Inject(CHAT_CONFIG) private readonly config: ChatConfig,
  ) {}
  @Post('login')
  @HttpCode(200)
  async login(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    browserWrite(req, this.config);
    res.set('Cache-Control', 'no-store');
    if (
      !body ||
      typeof body !== 'object' ||
      !('email' in body) ||
      typeof body.email !== 'string' ||
      body.email.length > 256 ||
      !('password' in body) ||
      typeof body.password !== 'string' ||
      !body.password ||
      body.password.length > 256
    )
      throw new UnauthorizedException();
    const result = await this.accounts.login(body.email, body.password);
    res.cookie('persona_session', result.token, {
      httpOnly: true,
      secure: this.config.secureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_AGE,
    });
    return result.snapshot;
  }
  @Get('session')
  async read(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    const account = await this.accounts.read(credential(req));
    return { id: account.id, email: account.email };
  }
  @Post('fresh-start')
  @HttpCode(200)
  freshStart(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    browserWrite(req, this.config);
    res.set('Cache-Control', 'no-store');
    return this.accounts.freshStart(credential(req));
  }
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    browserWrite(req, this.config);
    await this.accounts.logout(credential(req));
    res.set('Cache-Control', 'no-store');
    res.clearCookie('persona_session', {
      httpOnly: true,
      secure: this.config.secureCookies,
      sameSite: 'lax',
      path: '/',
    });
    return { signedOut: true };
  }
}
