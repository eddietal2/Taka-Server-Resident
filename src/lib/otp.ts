import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { env } from '../env.js';
import { AppError } from './http.js';
import { logger } from './logger.js';
import { maskPhone } from './phone.js';
import { AfricasTalkingOtpProvider } from './providers/africastalking.js';

/**
 * Delivery adapter. Swap in a real SMS provider by implementing this interface
 * and returning it from `getOtpProvider`.
 */
export interface OtpProvider {
  readonly name: string;
  /** Sends a one-time code. */
  send(phone: string, code: string): Promise<void>;
  /**
   * Sends a plain transactional notice with no code in it, such as the
   * confirmation that an account was deleted. Kept on the same adapter so a
   * deployment has exactly one place to configure SMS delivery.
   */
  sendMessage(phone: string, message: string): Promise<void>;
}

/**
 * Fallback provider: writes the code to the server log and sends nothing.
 *
 * The plaintext code is only included while `OTP_DEV_MODE` is on, which the
 * environment validation forbids in production, so a production log can never
 * leak a live code.
 */
class LogOtpProvider implements OtpProvider {
  readonly name = 'log';

  async send(phone: string, code: string): Promise<void> {
    logger.info('otp.dispatch', {
      provider: this.name,
      phone: maskPhone(phone),
      ...(env.OTP_DEV_MODE ? { code } : {}),
    });
  }

  /** Nothing is delivered; the notice is logged so a dev can see it happened. */
  async sendMessage(phone: string, _message: string): Promise<void> {
    logger.info('sms.dispatch', { provider: this.name, phone: maskPhone(phone) });
  }
}

let cachedProvider: OtpProvider | null = null;

/** Resolves the delivery adapter from `OTP_PROVIDER`, memoized per process. */
export function getOtpProvider(): OtpProvider {
  if (cachedProvider) return cachedProvider;
  cachedProvider = createOtpProvider();
  return cachedProvider;
}

/**
 * Sends a transactional notice, best-effort.
 *
 * A notice only ever follows something that has already succeeded — an account
 * that is already deleted — so a delivery failure must not turn that into an
 * error for the caller. The reason is logged instead.
 */
export async function sendAccountMessage(phone: string, message: string): Promise<void> {
  try {
    await getOtpProvider().sendMessage(phone, message);
  } catch (error) {
    logger.warn('sms.notice_failed', {
      phone: maskPhone(phone),
      reason: error instanceof Error ? error.name : 'unknown',
    });
  }
}

/**
 * Exhaustive switch so a provider added to `OTP_PROVIDER` but left unwired fails
 * loudly on the request instead of silently falling back to the log stub.
 */
function createOtpProvider(): OtpProvider {
  switch (env.OTP_PROVIDER) {
    case 'africastalking':
      return new AfricasTalkingOtpProvider();
    case 'log':
      return new LogOtpProvider();
    default:
      throw new AppError(`Unsupported OTP provider: ${env.OTP_PROVIDER}`, 503);
  }
}

/** Test seam: drops the memoized adapter so a new `OTP_PROVIDER` takes effect. */
export function resetOtpProvider(): void {
  cachedProvider = null;
}

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashOtpCode(phone: string, code: string): string {
  return createHmac('sha256', env.OTP_SECRET).update(`${phone}:${code}`).digest('hex');
}

/** Constant-time comparison of two hex encoded hashes. */
export function otpCodeMatches(storedHash: string, candidateHash: string): boolean {
  const stored = Buffer.from(storedHash, 'hex');
  const candidate = Buffer.from(candidateHash, 'hex');
  if (stored.length === 0 || stored.length !== candidate.length) return false;
  return timingSafeEqual(stored, candidate);
}

/**
 * True when the fixed dev code is supplied while OTP_DEV_MODE is on. Lets the
 * app be driven end to end without reading server logs.
 */
export function isDevBypassCode(code: string): boolean {
  return env.OTP_DEV_MODE && code === env.OTP_DEV_CODE;
}
