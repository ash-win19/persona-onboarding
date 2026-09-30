import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ChatErrors, credential } from './chat.controller.js';
import { browserWrite, owner } from './http-policy.js';
import { CHAT_CONFIG, type ChatConfig } from './config.js';
import { uuid } from './authority.js';
import { Workspace } from './workspace.js';

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= max;
}
function object(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') throw new BadRequestException();
  return body as Record<string, unknown>;
}

@Controller('workspace')
@UseFilters(ChatErrors)
export class WorkspaceController {
  constructor(
    @Inject(Workspace) private readonly workspace: Workspace,
    @Inject(CHAT_CONFIG) private readonly config: ChatConfig,
  ) {}
  @Get()
  read(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    return this.workspace.read(credential(req));
  }
  @Post('priorities')
  @HttpCode(200)
  priority(@Req() req: Request, @Body() input: unknown) {
    browserWrite(req, this.config);
    const body = object(input);
    if (!uuid(body.id) || !text(body.title, 500))
      throw new BadRequestException();
    return this.workspace.priority(
      credential(req),
      body.id,
      body.title.trim(),
      owner(req),
    );
  }
  @Patch('priorities/:id')
  complete(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    browserWrite(req, this.config);
    const body = object(input);
    if (!uuid(id) || typeof body.completed !== 'boolean')
      throw new BadRequestException();
    return this.workspace.complete(
      credential(req),
      id,
      body.completed,
      owner(req),
    );
  }
  @Get('threads/:id')
  thread(
    @Req() req: Request,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!uuid(id)) throw new BadRequestException();
    res.set('Cache-Control', 'no-store');
    return this.workspace.readThread(credential(req), id);
  }
  @Patch('onboarding-tasks/:id')
  completeOnboardingTask(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    browserWrite(req, this.config);
    const body = object(input);
    if (!/^[a-f0-9]{64}$/.test(id) || typeof body.completed !== 'boolean')
      throw new BadRequestException();
    return this.workspace.completeOnboardingTask(
      credential(req),
      id,
      body.completed,
      owner(req),
    );
  }
  @Post('threads/:id')
  @HttpCode(200)
  send(@Req() req: Request, @Param('id') id: string, @Body() input: unknown) {
    browserWrite(req, this.config);
    const body = object(input);
    if (!uuid(id) || !uuid(body.submissionId) || !text(body.content, 8000))
      throw new BadRequestException();
    return this.workspace.send(
      credential(req),
      id,
      body.submissionId,
      body.content.trim(),
      owner(req),
    );
  }
}
