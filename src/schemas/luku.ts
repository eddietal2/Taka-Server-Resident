import { z } from 'zod';

import { LUKU_METER_PATTERN } from './auth.js';

/** Biller code in nTZS's catalogue (`GET /api/v1/spend/billers`). */
export const LUKU_UTILITY_CODE = 'LUKU';

export const lukuLookupSchema = z.object({
  /** Kept as `luku_meter` so it matches the registration payload the app sends. */
  luku_meter: z.string().trim().regex(LUKU_METER_PATTERN, 'LUKU meters are 11 digits.'),
});

export type LukuLookupPayload = z.infer<typeof lukuLookupSchema>;
