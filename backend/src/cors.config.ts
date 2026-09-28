import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';

export function getCorsOptions(): CorsOptions {
  const configuredOrigin = process.env.FRONTEND_URL?.trim();

  if (!configuredOrigin && process.env.NODE_ENV === 'production') {
    throw new Error('FRONTEND_URL must be set in production.');
  }

  const frontendUrl = new URL(configuredOrigin || 'http://localhost:3000');

  if (
    !['http:', 'https:'].includes(frontendUrl.protocol) ||
    frontendUrl.username ||
    frontendUrl.password ||
    frontendUrl.pathname !== '/' ||
    frontendUrl.search ||
    frontendUrl.hash
  ) {
    throw new Error('FRONTEND_URL must be an HTTP(S) origin without a path.');
  }

  return { origin: [frontendUrl.origin] };
}
