import type { Context } from 'hono';

export type JsonStatus = 200 | 201 | 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503;

export type ErrorBody = {
  message: string;
  errors?: Record<string, string>;
};

/**
 * Application error carrying the status and optional field-level messages the
 * app client knows how to read (see taka-app-resident/src/api/client.ts).
 */
export class AppError extends Error {
  readonly status: JsonStatus;
  readonly errors?: Record<string, string>;

  constructor(message: string, status: JsonStatus = 400, errors?: Record<string, string>) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.errors = errors;
  }
}

/** Writes JSON without fighting Hono's generic response typing. */
function json(c: Context, body: unknown, status: JsonStatus): Response {
  return c.body(JSON.stringify(body), status, { 'Content-Type': 'application/json' });
}

export function ok(c: Context, data: unknown, status: JsonStatus = 200): Response {
  return json(c, data, status);
}

export function fail(
  c: Context,
  status: JsonStatus,
  message: string,
  errors?: Record<string, string>
): Response {
  const body: ErrorBody =
    errors && Object.keys(errors).length > 0 ? { message, errors } : { message };
  return json(c, body, status);
}
