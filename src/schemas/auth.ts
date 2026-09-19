import { z } from 'zod';

import { phoneSchema } from './phone.js';

/**
 * Mirrors taka-app-resident/src/api/schemas.ts so the client never sends a
 * payload the server rejects for a reason the app did not already enforce.
 */

export const LUKU_METER_PATTERN = /^\d{11}$/;
export const TAX_ID_PATTERN = /^\d{3}-\d{3}-\d{3}$/;

/** Provisional: the app currently only offers HIGH_VOLUME_DAILY. */
export const WASTE_TIERS = ['HIGH_VOLUME_DAILY'] as const;
export type WasteTier = (typeof WASTE_TIERS)[number];

const nameSchema = z.string().trim().min(2, 'Too short.').max(60, 'Too long.');
const localitySchema = z.string().trim().min(2, 'Required.').max(80, 'Too long.');
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
  street_mtaa: localitySchema,
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
  business_name: z.string().trim().min(2, 'Required.').max(120, 'Too long.'),
  ward_kata: localitySchema,
  street_mtaa: localitySchema,
  location: geoPointSchema,
  waste_tier: z.enum(WASTE_TIERS),
  tax_id: z.string().regex(TAX_ID_PATTERN, 'Use the 123-456-789 format.'),
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
