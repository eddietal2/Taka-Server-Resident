import { z } from 'zod';

import {
  businessNameSchema,
  geoPointSchema,
  LUKU_METER_PATTERN,
  localitySchema,
  nameSchema,
  taxIdSchema,
  USER_INTENTS,
} from './auth.js';
import { phoneSchema } from './phone.js';

/** Languages the app ships translations for. */
export const USER_LANGUAGES = ['en', 'sw'] as const;
export type UserLanguage = (typeof USER_LANGUAGES)[number];

/** Appearance choices the app is able to force. */
export const THEME_PREFERENCES = ['light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/**
 * Narrows a stored column to the language union.
 *
 * Used rather than a cast when reading the database back, so a value written
 * outside the API is dropped instead of being handed to the app's translator,
 * where an unrecognised key set would paint blank labels.
 */
export function isUserLanguage(value: string | null | undefined): value is UserLanguage {
  return value != null && (USER_LANGUAGES as readonly string[]).includes(value);
}

export function isThemePreference(value: string | null | undefined): value is ThemePreference {
  return value != null && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/**
 * The body of `PATCH /users/me`.
 *
 * Every field is optional because the app sends only what changed: picking a
 * language should not have to restate the picture. A `picture_url` is one the
 * presign route already minted, so its bytes are in storage by the time this
 * arrives — validated as an absolute http(s) URL rather than a free string, so a
 * caller cannot store a relative path or a `javascript:` value that the app
 * would later hand to an image loader. The length cap keeps the column bounded.
 */
export const updateUserSchema = z.object({
  /**
   * A personal name for a resident or reporter, and `business_name` for a
   * commercial account. Reaching for the registration schemas keeps the two in
   * step: a name the sign-up form would have accepted is never refused here.
   * Which pair applies is decided from the stored intent, not from the body.
   */
  first_name: nameSchema.optional(),
  last_name: nameSchema.optional(),
  business_name: businessNameSchema.optional(),
  /**
   * The TIN a commercial account is invoiced under. Taken from the same schema as
   * registration, so a number the sign-up form would have accepted is never
   * refused here, and which accounts may change it is decided from the stored
   * intent rather than from the body.
   */
  tax_id: taxIdSchema.optional(),
  picture_url: z
    .string()
    .trim()
    .max(2048)
    .regex(/^https?:\/\/\S+$/, 'Send the URL of an uploaded image.')
    .optional(),
  language: z.enum(USER_LANGUAGES).optional(),
  theme_preference: z.enum(THEME_PREFERENCES).optional(),
  /**
   * The role the account is used in. Only a role the account already holds may
   * be selected — switching is a change of view, not a registration — so the
   * service refuses any other. It is written before the rest of the update, so
   * the fields below land on the profile that will be active.
   */
  intent: z.enum(USER_INTENTS).optional(),
});

export type UpdateUserPayload = z.infer<typeof updateUserSchema>;

/**
 * The body of `POST /users/me/phone`.
 *
 * A new number is only stored once it has been proved reachable, so the caller
 * sends the short-lived `verification_token` that `otp/verify` issued for it.
 * The destination phone rides along so the route can check the two agree — the
 * server reads the number from the token, never from `phone` alone.
 */
export const changePhoneSchema = z.object({
  phone: phoneSchema,
  verification_token: z.string().trim().min(1, 'Required.'),
});

export type ChangePhonePayload = z.infer<typeof changePhoneSchema>;

/**
 * The body of `POST /users/me/site`.
 *
 * The address words and the pin are required because the profile columns are
 * non-null. The meter is optional because a commercial account may have none:
 * omitting it keeps the current meter, while an empty string detaches one. The
 * server writes this address onto the meter record too, so the profile and the
 * meter never disagree about where collections should go.
 */
export const updateSiteSchema = z.object({
  ward_kata: localitySchema,
  street_mtaa: z.string().trim().max(80, 'Too long.'),
  location: geoPointSchema,
  luku_meter: z
    .union([
      z.string().trim().regex(LUKU_METER_PATTERN, 'LUKU meters are 11 digits.'),
      z.literal(''),
    ])
    .optional(),
});

export type UpdateSitePayload = z.infer<typeof updateSiteSchema>;
