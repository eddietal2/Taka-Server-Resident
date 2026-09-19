import { Hono } from 'hono';

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
