import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import vercelHandler from '../src/index.js';

/**
 * Vercel's Node.js runtime invokes the default export with Node's (req, res) pair,
 * not a fetch Request. That mismatch produced "this.raw.headers.get is not a
 * function" in production and left the response unended, so this drives the
 * handler through a real http server to keep the Node path covered.
 */
let server: ReturnType<typeof createServer>;
let baseUrl = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    vercelHandler(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        baseUrl = `http://127.0.0.1:${address.port}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe('vercel default export over Node req/res', () => {
  it('serves the root probe', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ name: 'taka-server-resident' });
  });

  it('serves the health probe under /api/v1', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: 'ok' });
  });

  it('serves the JSON envelope for unknown routes', async () => {
    const res = await fetch(`${baseUrl}/api/v1/nope`);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ message: 'Not found.' });
  });
});
