import { createMiddleware } from 'hono/factory';

import { AppError } from '../lib/http.js';
import { verifyAccessToken, verifyVerificationToken } from '../lib/jwt.js';
import type { AppEnv } from '../types.js';

function readBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Gates register-*, login and luku/lookup on the short-lived token issued by
 * otp/verify.
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

/**
 * Gates presign, which is reached twice in an account's life.
 *
 * The first time is during sign-up, when the only proof available is the freshly
 * verified phone number and no user record exists yet. The second is from the
 * profile screen, when the account is established and the app holds an access
 * token instead — the verification token expires after fifteen minutes and is
 * never stored, so it is long gone by then.
 *
 * The verification token is tried first so the sign-up path keeps its exact
 * previous behaviour, including the phone-derived object key.
 */
export const requireUploadAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = readBearerToken(c.req.header('Authorization'));

  if (!token) {
    throw new AppError('Verify your phone number to continue.', 401);
  }

  const phone = await verifyVerificationToken(token);
  if (phone) {
    c.set('uploadOwner', { kind: 'phone', phone });
    await next();
    return;
  }

  const userId = await verifyAccessToken(token);
  if (userId) {
    c.set('uploadOwner', { kind: 'user', userId });
    await next();
    return;
  }

  throw new AppError('Your verification has expired. Request a new code.', 401);
});

/**
 * Gates routes only a signed-in account can reach.
 *
 * A verification token is deliberately not accepted here: it proves a phone
 * number was checked moments ago, not that the caller holds a session, and these
 * routes act on the account behind the token.
 */
export const requireAccessToken = createMiddleware<AppEnv>(async (c, next) => {
  const token = readBearerToken(c.req.header('Authorization'));

  if (!token) {
    throw new AppError('Sign in to continue.', 401);
  }

  const userId = await verifyAccessToken(token);
  if (!userId) {
    throw new AppError('Your session has expired. Sign in again.', 401);
  }

  c.set('authenticatedUserId', userId);
  await next();
});
