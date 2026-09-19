import { serve } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { app } from '../src/index';

/**
 * Exercises the @hono/node-server adapter over a real socket, so a regression in
 * the local dev entry point is caught even though the other tests use app.request().
 */
let server: ReturnType<typeof serve> | undefined;
let baseUrl = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      baseUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

describe('node server adapter', () => {
  it('serves the health probe over HTTP', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: 'ok' });
  });

  it('serves the 404 envelope over HTTP', async () => {
    const res = await fetch(`${baseUrl}/api/v1/does-not-exist`);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ message: 'Not found.' });
  });
});
