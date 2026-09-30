import { browserWrite, owner } from './http-policy.js';
import {
  BadRequestException,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
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
import { Authority, uuid } from './authority.js';
import { Calls } from './calls.js';

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

function turn(body: unknown) {
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
  return { submissionId: body.submissionId, content: body.content.trim() };
}

@Controller()
@UseFilters(ChatErrors)
export class ChatController {
  constructor(
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(CHAT_CONFIG) private readonly config: ChatConfig,
    @Inject(Authority) private readonly authority: Authority,
    @Inject(Calls) private readonly calls: Calls,
  ) {}
  @Post('control')
  @HttpCode(200)
  control(@Req() req: Request, @Body() body: unknown) {
    browserWrite(req, this.config);
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
    browserWrite(req, this.config);
    res.set('Cache-Control', 'no-store');
    return this.chat.open(credential(req));
  }
  @Get('session')
  read(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    return this.chat.read(credential(req));
  }
  // With Accept: text/event-stream the reply streams as server-sent events: a
  // snapshot once the message is saved, reply deltas, then the saved snapshot.
  // Rejections before the message is saved keep their status codes, and a
  // duplicate submission, like any other request, receives plain JSON.
  @Post('turns')
  async submit(
    @Req() req: Request,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    browserWrite(req, this.config);
    const { submissionId, content } = turn(body);
    const streaming = !!req.headers.accept?.includes('text/event-stream');
    let open = false;
    const send = (event: string, data: unknown) => {
      if (!open) {
        open = true;
        res.status(200).set({
          'Content-Type': 'text/event-stream; charset=utf-8',
          // no-transform stops proxies, including Next.js, compressing and
          // therefore buffering the stream.
          'Cache-Control': 'no-store, no-transform',
          'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    let snapshot: Awaited<ReturnType<ChatService['submit']>>;
    try {
      snapshot = await this.chat.submit(
        credential(req),
        submissionId,
        content,
        owner(req),
        streaming
          ? {
              start: (current) => send('snapshot', current),
              delta: (text) => send('delta', { text }),
            }
          : undefined,
      );
    } catch (error) {
      if (!open) throw error;
      send('error', { code: 'SERVICE_UNAVAILABLE' });
      res.end();
      return;
    }
    if (!open) {
      res.status(200).set('Cache-Control', 'no-store').json(snapshot);
      return;
    }
    send('done', snapshot);
    res.end();
  }

  @Post('journey')
  @HttpCode(200)
  async journey(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    browserWrite(req, this.config);
    res.set('Cache-Control', 'no-store');
    if (
      !body ||
      typeof body !== 'object' ||
      !('action' in body) ||
      !['prepare', 'skip', 'enter'].includes(String(body.action))
    )
      throw new BadRequestException();
    const action = body.action as 'prepare' | 'skip' | 'enter';
    const result = await this.chat.journey(credential(req), action, owner(req));
    if (result.journey.delivery === 'waiting' && action !== 'enter')
      await this.calls.handoff(credential(req), owner(req));
    if (action === 'enter')
      await this.calls.refreshContext(credential(req)).catch(() => undefined);
    return result;
  }

  @Post('onboarding/plan')
  @HttpCode(200)
  async plan(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    browserWrite(req, this.config);
    res.set('Cache-Control', 'no-store');
    if (
      !body ||
      typeof body !== 'object' ||
      !('action' in body) ||
      !['review', 'accept'].includes(String(body.action)) ||
      ('id' in body && typeof body.id !== 'string')
    )
      throw new BadRequestException();
    const result = await this.chat.plan(
      credential(req),
      body.action as 'review' | 'accept',
      'id' in body ? (body.id as string) : undefined,
      owner(req),
    );
    if (result.message)
      await this.calls.sayPlan(credential(req), result.message);
    if (body.action === 'accept')
      await this.calls.refreshContext(credential(req)).catch(() => undefined);
    return result.snapshot;
  }
}
