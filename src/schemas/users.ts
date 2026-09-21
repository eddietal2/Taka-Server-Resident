import { z } from 'zod';

/**
 * The body of `PATCH /users/me`.
 *
 * The URL is one the presign route just handed out, so the bytes are already in
 * storage by the time this arrives: the request only records which object is
 * current. Validated as an absolute http(s) URL rather than a free string so a
 * caller cannot store a relative path or a `javascript:` value the app would
 * later hand to an image loader. The length cap keeps the column bounded.
 */
export const updateProfileImageSchema = z.object({
  picture_url: z
    .string()
    .trim()
    .max(2048)
    .regex(/^https?:\/\/\S+$/, 'Send the URL of an uploaded image.'),
});

export type UpdateProfileImagePayload = z.infer<typeof updateProfileImageSchema>;
