import { z } from 'zod';

import { phoneSchema } from './phone.js';

/**
 * Mirrors taka-app-resident/src/api/schemas.ts so the client never sends a
 * payload the server rejects for a reason the app did not already enforce.
 */

export const LUKU_METER_PATTERN = /^\d{11}$/;
export const TAX_ID_PATTERN = /^\d{3}-\d{3}-\d{3}$/;

/**
 * Must match WASTE_TIERS in taka-app-resident/src/constants/registration.ts —
 * a tier the app offers but this list omits is rejected by `register-commercial`.
 */
export const WASTE_TIERS = [
  'LOW_VOLUME_WEEKLY',
  'MEDIUM_VOLUME_TWICE_WEEKLY',
  'HIGH_VOLUME_DAILY',
] as const;
export type WasteTier = (typeof WASTE_TIERS)[number];

/** Exported so editing a name later is held to the same rules as registering one. */
export const nameSchema = z.string().trim().min(2, 'Too short.').max(60, 'Too long.');
export const businessNameSchema = z.string().trim().min(2, 'Required.').max(120, 'Too long.');
export const localitySchema = z.string().trim().min(2, 'Required.').max(80, 'Too long.');
/** Also exported, so editing a TIN later cannot accept one sign-up would refuse. */
export const taxIdSchema = z.string().regex(TAX_ID_PATTERN, 'Use the 123-456-789 format.');
/**
 * Street / mtaa. Optional for now: not everyone knows theirs, and the details
 * step no longer requires one, so an empty value has to validate.
 */
const streetSchema = z.string().trim().max(80, 'Too long.');
const imageUrlSchema = z.string().trim().min(1, 'Required.');

export const geoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const residentPayloadSchema = z.object({
  phone: phoneSchema,
  intent: z.literal('RESIDENT'),
  first_name: nameSchema,
  last_name: nameSchema,
  ward_kata: localitySchema,
  street_mtaa: streetSchema,
  luku_meter: z.string().regex(LUKU_METER_PATTERN, 'LUKU meters are 11 digits.'),
  location: geoPointSchema,
  unit_number: z.string().trim().max(60, 'Too long.'),
  profile_picture: imageUrlSchema,
});

export const reporterPayloadSchema = z.object({
  phone: phoneSchema,
  intent: z.literal('REPORTER'),
  first_name: nameSchema,
  last_name: nameSchema,
  profile_picture: imageUrlSchema,
});

export const commercialPayloadSchema = z.object({
  phone: phoneSchema,
  intent: z.literal('COMMERCIAL'),
  business_name: businessNameSchema,
  ward_kata: localitySchema,
  street_mtaa: streetSchema,
  location: geoPointSchema,
  /**
   * A business may share or lack a meter, so this is optional — but when the
   * sign-up lookup confirmed one, the reference is kept on the profile.
   */
  luku_meter: z.string().regex(LUKU_METER_PATTERN, 'LUKU meters are 11 digits.').optional(),
  waste_tier: z.enum(WASTE_TIERS),
  tax_id: taxIdSchema,
  business_logo: imageUrlSchema,
});

export const registerPayloadSchema = z.discriminatedUnion('intent', [
  residentPayloadSchema,
  reporterPayloadSchema,
  commercialPayloadSchema,
]);

export type ResidentPayload = z.infer<typeof residentPayloadSchema>;
export type ReporterPayload = z.infer<typeof reporterPayloadSchema>;
export type CommercialPayload = z.infer<typeof commercialPayloadSchema>;
export type RegisterPayload = z.infer<typeof registerPayloadSchema>;
