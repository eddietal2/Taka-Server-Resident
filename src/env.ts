import { z } from 'zod';

/**
 * Reads a boolean from an env var without the `Boolean("false") === true`
 * trap that `z.coerce.boolean()` falls into.
 */
const booleanFromEnv = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === ''
        ? defaultValue
        : ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase())
    );

const urlString = z.string().min(1).refine((value) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}, 'Must be a valid URL.');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required (use the same value as DATABASE_URL if not on Neon).'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters.'),
  VERIFICATION_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),

  OTP_SECRET: z.string().min(16, 'OTP_SECRET must be at least 16 characters.'),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_RESEND_SECONDS: z.coerce.number().int().nonnegative().default(60),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RETENTION_SECONDS: z.coerce.number().int().nonnegative().default(86_400),
  OTP_DEV_MODE: booleanFromEnv(false),
  OTP_DEV_CODE: z.string().regex(/^\d{6}$/, 'OTP_DEV_CODE must be exactly 6 digits.').default('000000'),
  OTP_MESSAGE_TEMPLATE: z
    .string()
    .default('Taka: {{code}} is your verification code. It expires in {{minutes}} minutes.'),

  // Delivery adapter. "africastalking" sends real SMS; "log" writes the code to
  // the server log and is intended for tests and offline work only.
  OTP_PROVIDER: z.enum(['log', 'africastalking']).default('log'),
  AT_USERNAME: z.string().trim().optional(),
  // Trimmed because a pasted key commonly carries a trailing newline, which the
  // API reports as invalid authentication rather than a malformed value.
  AT_API_KEY: z.string().trim().optional(),
  // Optional: empty falls back to the Africa's Talking shared shortcode.
  AT_SENDER_ID: z.string().trim().optional(),
  // Sandbox host simulates delivery; production must use api.africastalking.com.
  AT_SMS_ENDPOINT: urlString.default(
    'https://api.sandbox.africastalking.com/version1/messaging'
  ),
  AT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  REGISTRATION_AUTO_APPROVE: booleanFromEnv(true),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: urlString.optional(),
  R2_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  CORS_ORIGINS: z.string().default(''),
})
  .superRefine((value, ctx) => {
    // The dev bypass echoes the code back in the API response, so it must never
    // be enabled in production.
    if (value.NODE_ENV === 'production' && value.OTP_DEV_MODE) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_DEV_MODE'],
        message: 'OTP_DEV_MODE must be false in production.',
      });
    }

    if (value.OTP_PROVIDER !== 'africastalking') return;

    const required = [
      ['AT_USERNAME', value.AT_USERNAME],
      ['AT_API_KEY', value.AT_API_KEY],
    ] as const;

    for (const [name, setting] of required) {
      if (!setting || setting.trim() === '') {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} is required when OTP_PROVIDER=africastalking.`,
        });
      }
    }

    // Refuse to deploy the sandbox host to production: it simulates delivery, so
    // real users would never receive a code.
    if (value.NODE_ENV === 'production' && value.AT_SMS_ENDPOINT.includes('sandbox')) {
      ctx.addIssue({
        code: 'custom',
        path: ['AT_SMS_ENDPOINT'],
        message: 'AT_SMS_ENDPOINT must not use the sandbox host in production.',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map(
    (issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`
  );
  throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
