import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import type { ChatConfig } from './config.js';
import { uuid, type Owner } from './authority.js';
export function owner(req: Request): Owner | undefined {
  const tabId = req.headers['x-persona-tab'],
    epoch = Number(req.headers['x-persona-epoch']);
  if (tabId === undefined && req.headers['x-persona-epoch'] === undefined)
    return undefined;
  if (!uuid(tabId) || !Number.isSafeInteger(epoch) || epoch < 1)
    throw new BadRequestException();
  return { tabId, epoch };
}
export function browserWrite(
  req: Request,
  config: ChatConfig,
  requireOwner: true,
): Owner;
export function browserWrite(
  req: Request,
  config: ChatConfig,
  requireOwner?: false,
): Owner | undefined;
export function browserWrite(
  req: Request,
  config: ChatConfig,
  requireOwner = false,
): Owner | undefined {
  if (
    !config.origins.includes(req.headers.origin ?? '') ||
    req.headers['x-persona-client'] !== 'web'
  )
    throw new ForbiddenException();
  if (!req.is('application/json')) throw new BadRequestException();
  const control = owner(req);
  if (requireOwner && !control) throw new ForbiddenException();
  return control;
}
