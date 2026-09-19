import { Hono } from 'hono';

import { ok } from '../lib/http.js';
import type { AppEnv } from '../types.js';

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get('/health', (c) => ok(c, { status: 'ok', time: new Date().toISOString() }));
