import { z } from 'zod';

/** Must stay in sync with taka-app-resident/src/api/schemas.ts */
export const TANZANIA_PHONE_PATTERN = /^\+255\d{9}$/;

export const phoneSchema = z
  .string()
  .trim()
  .regex(TANZANIA_PHONE_PATTERN, 'Use the +255XXXXXXXXX format.');

export const otpRequestSchema = z.object({
  phone: phoneSchema,
});

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});
