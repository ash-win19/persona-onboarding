import {
  BadRequestException,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
  UseFilters,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CHAT_CONFIG, type ChatConfig } from './config.js';
import { ChatService } from './chat.service.js';
import { Authority, uuid, type Owner } from './authority.js';

const COOKIE = 'persona_session';
export const credential = (req: Request) =>
  req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);

@Catch()
export class ChatErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const status = error instanceof HttpException ? error.getStatus() : 503;
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .set('Cache-Control', 'no-store')
      .json({
        code:
          status === 503
            ? 'SERVICE_UNAVAILABLE'
            : status === 401
              ? 'SESSION_REQUIRED'
              : 'REQUEST_REJECTED',
      });
  }
}

@Controller()
@UseFilters(ChatErrors)
export class ChatController {
  constructor(
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(CHAT_CONFIG) private readonly config: ChatConfig,
    @Inject(Authority) private readonly authority: Authority,
  ) {}
  private allowWrite(req: Request) {
    if (
      !this.config.origins.includes(req.headers.origin ?? '') ||
      req.headers['x-persona-client'] !== 'web'
    )
      throw new ForbiddenException();
    if (!req.is('application/json')) throw new BadRequestException();
  }
  @Post('control')
  @HttpCode(200)
  control(@Req() req: Request, @Body() body: unknown) {
    this.allowWrite(req);
    if (
      !body ||
      typeof body !== 'object' ||
      !('tabId' in body) ||
      !uuid(body.tabId) ||
      !('takeover' in body) ||
      typeof body.takeover !== 'boolean'
    )
      throw new BadRequestException();
    return this.authority.claim(credential(req), body.tabId, body.takeover);
  }
  @Get('ready')
  ready(@Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    return this.chat.ready();
  }
  @Post('session')
  async session(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.allowWrite(req);
    res.set('Cache-Control', 'no-store');
    if (credential(req)) return this.chat.read(credential(req));
    const result = await this.chat.create();
    res.cookie(COOKIE, result.credential, {
      httpOnly: true,
      secure: this.config.secureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: 180 * 86400 * 1000,
    });
    return result.snapshot;
  }
  @Get('session')
  read(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    return this.chat.read(credential(req));
  }
  @Post('turns')
  @HttpCode(200)
  submit(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.allowWrite(req);
    res.set('Cache-Control', 'no-store');
    if (
      !body ||
      typeof body !== 'object' ||
      !('submissionId' in body) ||
      typeof body.submissionId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        body.submissionId,
      ) ||
      !('content' in body) ||
      typeof body.content !== 'string' ||
      !body.content.trim() ||
      body.content.length > 8000
    )
      throw new BadRequestException();
    return this.chat.submit(
      credential(req),
      body.submissionId,
      body.content.trim(),
      owner(req),
    );
  }
}

export function owner(req: Request): Owner | undefined {
  const tabId = req.headers['x-persona-tab'];
  const epoch = Number(req.headers['x-persona-epoch']);
  if (tabId === undefined && req.headers['x-persona-epoch'] === undefined)
    return undefined;
  if (!uuid(tabId) || !Number.isSafeInteger(epoch) || epoch < 1)
    throw new BadRequestException();
  return { tabId, epoch };
}
