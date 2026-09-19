import { createMiddleware } from 'hono/factory';

import { AppError } from '../lib/http';
import { verifyVerificationToken } from '../lib/jwt';
import type { AppEnv } from '../types';

function readBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Gates presign and register-* on the short-lived token issued by otp/verify.
 */
export const requireVerificationToken = createMiddleware<AppEnv>(async (c, next) => {
  const token = readBearerToken(c.req.header('Authorization'));

  if (!token) {
    throw new AppError('Verify your phone number to continue.', 401);
  }

  const phone = await verifyVerificationToken(token);
  if (!phone) {
    throw new AppError('Your verification has expired. Request a new code.', 401);
  }

  c.set('verificationPhone', phone);
  await next();
});
