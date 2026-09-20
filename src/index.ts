import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';

import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/error.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { lukuRoutes } from './routes/luku.js';
import { uploadRoutes } from './routes/uploads.js';
import type { AppEnv } from './types.js';

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', corsMiddleware());
  app.onError(errorHandler);
  app.notFound((c) =>
    c.body(JSON.stringify({ message: 'Not found.' }), 404, { 'Content-Type': 'application/json' })
  );

  app.get('/', (c) =>
    c.body(
      JSON.stringify({ name: 'taka-server-resident', status: 'ok' }),
      200,
      { 'Content-Type': 'application/json' }
    )
  );

  const api = new Hono<AppEnv>();
  api.route('/', healthRoutes);
  api.route('/', authRoutes);
  api.route('/', uploadRoutes);
  api.route('/', lukuRoutes);

  app.route('/api/v1', api);

  return app;
}

export const app = createApp();

type NodeRequestListener = (request: unknown, response: unknown) => void;

const nodeRequestListener = getRequestListener(app.fetch) as unknown as NodeRequestListener;

/** A fetch Request exposes a Headers instance; a Node request exposes a plain object. */
function isFetchRequest(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const headers = (value as { headers?: unknown }).headers;
  if (typeof headers !== 'object' || headers === null) return false;
  return typeof (headers as { get?: unknown }).get === 'function';
}

/**
 * Vercel loads this module as the serverless entry and invokes the default export.
 *
 * Its Node.js runtime calls the handler with Node's (req, res) pair, whereas Edge
 * and Web-standard runtimes pass a fetch Request. `hono/vercel`'s handle assumed
 * the latter, which produced "this.raw.headers.get is not a function" and left the
 * response unended, so the request hung.
 *
 * This export covers both shapes: a fetch Request goes straight to app.fetch, and
 * anything else is handed to @hono/node-server, which reads the Node request and
 * writes the response. api/index.ts re-exports this for the api-directory convention.
 */
export default function vercelHandler(request: unknown, response?: unknown): unknown {
  if (isFetchRequest(request)) {
    return app.fetch(request as Request);
  }

  nodeRequestListener(request, response);
  return undefined;
}
