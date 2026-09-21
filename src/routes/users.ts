import { Hono } from 'hono';

import { ok } from '../lib/http.js';
import { readValidatedJson } from '../lib/validate.js';
import { requireAccessToken } from '../middleware/auth.js';
import { updateProfileImageSchema } from '../schemas/users.js';
import { updateProfileImage } from '../services/users.js';
import type { AppEnv } from '../types.js';

export const usersRoutes = new Hono<AppEnv>();

/**
 * Replaces the signed-in account's image.
 *
 * The response carries the whole updated user, so the app can store what the
 * server actually holds rather than echoing back what it sent.
 */
usersRoutes.patch('/users/me', requireAccessToken, async (c) => {
  const { picture_url } = await readValidatedJson(c, updateProfileImageSchema);
  const account = await updateProfileImage(c.get('authenticatedUserId'), picture_url);

  return ok(c, { status: account.status, user: account.user });
});
