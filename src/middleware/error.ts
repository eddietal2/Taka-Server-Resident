import type { Context } from 'hono';
import { ZodError } from 'zod';

import { AppError, fail } from '../lib/http';
import { logger } from '../lib/logger';

type PrismaLikeError = {
  name?: string;
  code?: string;
  meta?: { target?: unknown };
};

/** Prisma reports camelCase columns; the app payload uses snake_case keys. */
const FIELD_ALIASES: Record<string, string> = {
  lukuMeter: 'luku_meter',
  taxId: 'tax_id',
  phone: 'phone',
};

function isPrismaKnownError(error: unknown): error is PrismaLikeError {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { name?: unknown }).name === 'PrismaClientKnownRequestError';
}

function toFieldErrors(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const rawKey = issue.path.length > 0 ? issue.path.join('.') : 'form';
    const key = FIELD_ALIASES[rawKey] ?? rawKey;
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

function prismaTargetFields(error: PrismaLikeError): string[] {
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.filter((item): item is string => typeof item === 'string');
  }
  if (typeof target === 'string') return [target];
  return [];
}

/**
 * Single place that turns thrown errors into the JSON envelope the app client
 * parses: `{ message }` plus optional field-keyed `errors`.
 */
export function errorHandler(error: unknown, c: Context): Response {
  if (error instanceof AppError) {
    return fail(c, error.status, error.message, error.errors);
  }

  if (error instanceof ZodError) {
    return fail(c, 400, 'Some details need fixing.', toFieldErrors(error));
  }

  if (isPrismaKnownError(error) && error.code === 'P2002') {
    const errors: Record<string, string> = {};
    for (const field of prismaTargetFields(error)) {
      errors[FIELD_ALIASES[field] ?? field] = 'This value is already in use.';
    }
    return fail(
      c,
      409,
      'Some of these details are already registered.',
      Object.keys(errors).length > 0 ? errors : undefined
    );
  }

  const detail =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: 'UnknownError', message: String(error) };

  logger.error('unhandled_error', detail);

  return fail(c, 500, 'Something went wrong on our side. Please try again.');
}
