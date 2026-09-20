import { z } from 'zod';

import { LUKU_METER_PATTERN } from './auth.js';
import { phoneSchema } from './phone.js';

/** Biller code in nTZS's catalogue (`GET /api/v1/spend/billers`). */
export const LUKU_UTILITY_CODE = 'LUKU';

/**
 * The enquiry is keyed by the meter the resident reads off the box, but it also
 * carries the phone number from the sign-up flow. The handler asserts that
 * number matches the token, exactly like the register payloads, so a lookup
 * cannot be run on someone else's behalf.
 */
export const lukuLookupSchema = z.object({
  phone: phoneSchema,
  /** Kept as `luku_meter` so it matches the registration payload the app sends. */
  luku_meter: z.string().trim().regex(LUKU_METER_PATTERN, 'LUKU meters are 11 digits.'),
});

/**
 * Pins a GPS point to a LUKU reference number.
 *
 * Coordinates only: the ward and street are attached when the account is
 * registered, from the words the resident actually typed. A reverse-geocoded
 * street is frequently the ward's name repeated, which is exactly the value that
 * must not end up on the meter record.
 */
export const lukuLocationSchema = z.object({
  phone: phoneSchema,
  luku_meter: z.string().trim().regex(LUKU_METER_PATTERN, 'LUKU meters are 11 digits.'),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
});

export type LukuLookupPayload = z.infer<typeof lukuLookupSchema>;
export type LukuLocationPayload = z.infer<typeof lukuLocationSchema>;
