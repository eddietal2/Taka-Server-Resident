import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';

import { env } from '../env';

const allowedOrigins = env.CORS_ORIGINS.split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

/**
 * Native builds send no Origin header, so this mainly serves the Expo web
 * build. Empty CORS_ORIGINS falls back to `*` and is intended for dev only.
 */
export function corsMiddleware(): MiddlewareHandler {
  return cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Accept'],
    maxAge: 86_400,
  });
}
