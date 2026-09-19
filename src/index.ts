import { Hono } from 'hono';
import { handle } from 'hono/vercel';

import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/error.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
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

  app.route('/api/v1', api);

  return app;
}

export const app = createApp();

/**
 * Vercel loads this module as the serverless entry and requires a default export
 * that is a function or server; `handle(app)` is that fetch handler. The entry in
 * api/index.ts is kept because the api-directory convention may be used instead.
 */
export default handle(app);
