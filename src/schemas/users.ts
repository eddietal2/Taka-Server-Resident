import { z } from 'zod';

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
  picture_url: z
    .string()
    .trim()
    .max(2048)
    .regex(/^https?:\/\/\S+$/, 'Send the URL of an uploaded image.')
    .optional(),
  language: z.enum(USER_LANGUAGES).optional(),
  theme_preference: z.enum(THEME_PREFERENCES).optional(),
});

export type UpdateUserPayload = z.infer<typeof updateUserSchema>;
