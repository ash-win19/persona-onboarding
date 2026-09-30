import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Authority, uuid } from './authority.js';
import { credential } from './chat.controller.js';
import { CHAT_CONFIG, type ChatConfig } from './config.js';
import { DATABASE, type Database } from './database.js';
import { browserWrite } from './http-policy.js';
import { Calendar } from './calendar.js';
import { Meetings, validTimeZone } from './meetings.js';
import { Calls } from './calls.js';

@Catch()
class CalendarErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const status = error instanceof HttpException ? error.getStatus() : 503;
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .set('Cache-Control', 'no-store')
      .json({
        code:
          error instanceof HttpException
            ? error.message
            : 'CALENDAR_UNAVAILABLE',
      });
  }
}
@Controller()
@UseFilters(CalendarErrors)
export class CalendarController {
  constructor(
    @Inject(Calendar) private readonly calendar: Calendar,
    @Inject(Meetings) private readonly meetings: Meetings,
    @Inject(Authority) private readonly authority: Authority,
    @Inject(CHAT_CONFIG) private readonly config: ChatConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(Calls) private readonly calls: Calls,
  ) {}
  @Get('calendar/status')
  async status(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    return this.meetings.state(
      (await this.authority.authorize(credential(req))).id,
    );
  }
  @Post('calendar/start')
  @HttpCode(200)
  start(@Req() req: Request) {
    return this.calendar.start(
      credential(req),
      browserWrite(req, this.config, true),
    );
  }
  @Post('calendar/cancel')
  @HttpCode(200)
  cancel(@Req() req: Request, @Body() body: { id?: unknown }) {
    const owner = browserWrite(req, this.config, true);
    if (!uuid(body?.id)) throw new BadRequestException();
    return this.calendar.cancel(credential(req), owner, body.id);
  }
  @Post('calendar/timezone')
  @HttpCode(200)
  async timezone(@Req() req: Request, @Body() body: { timeZone?: unknown }) {
    const owner = browserWrite(req, this.config, true);
    if (!validTimeZone(body?.timeZone)) throw new BadRequestException();
    await this.db.transaction(async (sql) => {
      const c = await this.authority.authorize(credential(req), sql, true);
      this.authority.assertOwner(c, owner);
      await sql.query(
        'UPDATE conversations SET meeting_timezone=$2 WHERE id=$1',
        [c.id, body.timeZone],
      );
    });
    return { ok: true };
  }
  @Get('calendar/callback')
  async callback(
    @Req() req: Request,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ) {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    if (
      typeof query.state !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(query.state) ||
      (query.code !== undefined &&
        (typeof query.code !== 'string' || query.code.length > 4096)) ||
      (query.error !== undefined &&
        (typeof query.error !== 'string' || query.error.length > 200))
    )
      throw new BadRequestException();
    const result = await this.calendar.callback(
      credential(req),
      query.state,
      query.code as string | undefined,
      query.error as string | undefined,
    );
    if (result === 'connected')
      await this.calls.refreshContext(credential(req)).catch(() => undefined);
    res.redirect(
      303,
      this.config.origins[0] +
        '/dashboard/conversation?calendar=' +
        encodeURIComponent(result),
    );
  }
  @Post('meetings/:id/execute')
  @HttpCode(200)
  async execute(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { expectedRevision?: unknown },
  ) {
    const owner = browserWrite(req, this.config, true);
    if (!uuid(id) || !Number.isSafeInteger(body?.expectedRevision))
      throw new BadRequestException();
    const c = await this.authority.authorize(credential(req));
    if (!this.calendar.available())
      throw new BadRequestException('CALENDAR_NOT_CONFIGURED');
    return this.meetings.execute(
      { conversationId: c.id, sourceId: id, owner },
      id,
      Number(body.expectedRevision),
    );
  }
  @Post('meetings/:id/resume')
  @HttpCode(200)
  async resume(@Req() req: Request, @Param('id') id: string) {
    const owner = browserWrite(req, this.config, true);
    if (!uuid(id)) throw new BadRequestException();
    const c = await this.authority.authorize(credential(req));
    return this.meetings.resume(
      { conversationId: c.id, sourceId: id, owner },
      id,
    );
  }
  @Post('meetings/:id/dismiss')
  @HttpCode(200)
  async dismiss(@Req() req: Request, @Param('id') id: string) {
    const owner = browserWrite(req, this.config, true);
    if (!uuid(id)) throw new BadRequestException();
    const c = await this.authority.authorize(credential(req));
    return this.meetings.dismiss(
      { conversationId: c.id, sourceId: id, owner },
      id,
    );
  }
}
