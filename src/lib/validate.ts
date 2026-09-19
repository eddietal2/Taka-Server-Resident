import type { Context } from 'hono';
import type { z } from 'zod';

import { AppError } from './http.js';

/**
 * Parses and validates a JSON request body. Throws the ZodError so the global
 * error handler can turn it into a 400 with field-level `errors`.
 */
export async function readValidatedJson<S extends z.ZodType>(
  c: Context,
  schema: S
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError('Send a JSON body with this request.', 400);
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw result.error;
  }

  return result.data;
}
