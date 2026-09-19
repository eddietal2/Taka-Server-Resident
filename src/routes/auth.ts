import { Hono } from 'hono';

import { env } from '../env';
import { AppError, ok } from '../lib/http';
import { signAccessToken, signVerificationToken } from '../lib/jwt';
import { logger } from '../lib/logger';
import {
  generateOtpCode,
  getOtpProvider,
  hashOtpCode,
  isDevBypassCode,
  otpCodeMatches,
} from '../lib/otp';
import { prisma } from '../lib/prisma';
import { readValidatedJson } from '../lib/validate';
import { requireVerificationToken } from '../middleware/auth';
import {
  commercialPayloadSchema,
  reporterPayloadSchema,
  residentPayloadSchema,
  type RegisterPayload,
} from '../schemas/auth';
import { otpRequestSchema, otpVerifySchema } from '../schemas/phone';
import { createRegistration } from '../services/registration';
import type { AppEnv } from '../types';

export const authRoutes = new Hono<AppEnv>();

/**
 * Deletes challenges past the retention window so the table cannot grow without
 * bound. Best-effort: a cleanup failure must never block sign-up.
 */
async function retireStaleChallenges(): Promise<void> {
  if (env.OTP_RETENTION_SECONDS <= 0) return;

  try {
    await prisma.otpChallenge.deleteMany({
      where: {
        createdAt: { lt: new Date(Date.now() - env.OTP_RETENTION_SECONDS * 1000) },
      },
    });
  } catch (error) {
    logger.warn('otp.cleanup_failed', {
      reason: error instanceof Error ? error.name : 'unknown',
    });
  }
}

authRoutes.post('/auth/otp/request', async (c) => {
  const { phone } = await readValidatedJson(c, otpRequestSchema);

  await retireStaleChallenges();

  if (env.OTP_RESEND_SECONDS > 0) {
    const latest = await prisma.otpChallenge.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    if (latest) {
      const elapsedSeconds = (Date.now() - latest.createdAt.getTime()) / 1000;
      if (elapsedSeconds < env.OTP_RESEND_SECONDS) {
        const waitSeconds = Math.max(1, Math.ceil(env.OTP_RESEND_SECONDS - elapsedSeconds));
        throw new AppError(
          `Please wait ${waitSeconds} seconds before requesting another code.`,
          429,
          { phone: `Please wait ${waitSeconds} seconds.` }
        );
      }
    }
  }

  // Any earlier unused code for this number is retired.
  await prisma.otpChallenge.updateMany({
    where: { phone, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = generateOtpCode();

  const challenge = await prisma.otpChallenge.create({
    data: {
      phone,
      codeHash: hashOtpCode(phone, code),
      expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000),
    },
    select: { id: true },
  });

  try {
    await getOtpProvider().send(phone, code);
  } catch (error) {
    // The code never reached the user, so drop the challenge instead of leaving
    // an orphan that would also trip the resend cooldown on the next attempt.
    await prisma.otpChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);

    if (error instanceof AppError) throw error;

    logger.error('otp.dispatch_failed', {
      reason: error instanceof Error ? error.name : 'unknown',
    });
    throw new AppError('We could not send the verification code. Please try again.', 503);
  }

  return ok(c, {
    expires_in: env.OTP_TTL_SECONDS,
    resend_after: env.OTP_RESEND_SECONDS,
    // Dev/Preview convenience: the app ignores unknown fields; the log has it too.
    ...(env.OTP_DEV_MODE ? { dev_code: code } : {}),
  });
});

authRoutes.post('/auth/otp/verify', async (c) => {
  const { phone, code } = await readValidatedJson(c, otpVerifySchema);

  const challenge = await prisma.otpChallenge.findFirst({
    where: { phone, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!challenge) {
    throw new AppError('That code is incorrect or has expired. Request a new one.', 400, {
      code: 'Request a new code.',
    });
  }

  if (challenge.expiresAt.getTime() <= Date.now()) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
    throw new AppError('That code has expired. Request a new one.', 400, { code: 'Code expired.' });
  }

  if (challenge.attempts >= env.OTP_MAX_ATTEMPTS) {
    throw new AppError('Too many attempts. Request a new code.', 429, {
      code: 'Too many attempts.',
    });
  }

  const matches =
    isDevBypassCode(code) || otpCodeMatches(challenge.codeHash, hashOtpCode(phone, code));

  if (!matches) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    throw new AppError('That code is incorrect. Check it and try again.', 400, {
      code: 'Incorrect code.',
    });
  }

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  const verificationToken = await signVerificationToken(phone);

  return ok(c, {
    verification_token: verificationToken,
    expires_in: env.VERIFICATION_TOKEN_TTL_SECONDS,
  });
});

async function completeRegistration(verifiedPhone: string, payload: RegisterPayload) {
  if (payload.phone !== verifiedPhone) {
    throw new AppError('This number does not match the number you verified.', 403, {
      phone: 'Does not match the verified number.',
    });
  }

  const outcome = await createRegistration(payload);
  const token =
    outcome.status === 'ACTIVE' ? await signAccessToken(outcome.user.id) : undefined;

  return { token, status: outcome.status, user: outcome.user };
}

authRoutes.post('/auth/register-resident', requireVerificationToken, async (c) => {
  const payload = await readValidatedJson(c, residentPayloadSchema);
  const result = await completeRegistration(c.get('verificationPhone'), payload);
  return ok(c, result, 201);
});

authRoutes.post('/auth/register-reporter', requireVerificationToken, async (c) => {
  const payload = await readValidatedJson(c, reporterPayloadSchema);
  const result = await completeRegistration(c.get('verificationPhone'), payload);
  return ok(c, result, 201);
});

authRoutes.post('/auth/register-commercial', requireVerificationToken, async (c) => {
  const payload = await readValidatedJson(c, commercialPayloadSchema);
  const result = await completeRegistration(c.get('verificationPhone'), payload);
  return ok(c, result, 201);
});
