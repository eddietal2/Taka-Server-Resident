import { Hono } from 'hono';

import { ok } from '../lib/http';
import type { AppEnv } from '../types';

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get('/health', (c) => ok(c, { status: 'ok', time: new Date().toISOString() }));
