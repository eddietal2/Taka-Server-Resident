import { Hono } from 'hono';

import { AppError, ok } from '../lib/http.js';
import { readValidatedJson } from '../lib/validate.js';
import { requireAccessToken } from '../middleware/auth.js';
import { updateUserSchema } from '../schemas/users.js';
import { updateUser } from '../services/users.js';
import type { AppEnv } from '../types.js';

export const usersRoutes = new Hono<AppEnv>();

/**
 * Partially updates the signed-in account: its image, its language, its
 * appearance, or any combination.
 *
 * The response carries the whole updated user, so the app can store what the
 * server actually holds rather than echoing back what it sent — which is what
 * keeps a preference set on one device from disagreeing with the next.
 */
usersRoutes.patch('/users/me', requireAccessToken, async (c) => {
  const payload = await readValidatedJson(c, updateUserSchema);

  // An empty body would return 200 having changed nothing, which reads as a bug
  // to whoever sent it. Say so instead.
  if (Object.keys(payload).length === 0) {
    throw new AppError('Send at least one field to update.', 400);
  }

  const account = await updateUser(c.get('authenticatedUserId'), payload);

  return ok(c, { status: account.status, user: account.user });
});
