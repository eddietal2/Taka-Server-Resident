import { Hono } from 'hono';

import { env } from '../env.js';
import { AppError, ok } from '../lib/http.js';
import { verifyVerificationToken } from '../lib/jwt.js';
import { sendAccountMessage } from '../lib/otp.js';
import { readValidatedJson } from '../lib/validate.js';
import { requireAccessToken } from '../middleware/auth.js';
import { changePhoneSchema, updateSiteSchema, updateUserSchema } from '../schemas/users.js';
import { findUserById } from '../services/registration.js';
import { changePhone, deleteAccount, updateSite, updateUser } from '../services/users.js';
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
/**
 * Reads the signed-in account.
 *
 * The app stores the account it signed in with, but its address and meter are
 * edited from another screen and can change underneath it, so a screen that
 * needs them asks for the server's copy rather than trusting the cache.
 */
usersRoutes.get('/users/me', requireAccessToken, async (c) => {
  const account = await findUserById(c.get('authenticatedUserId'));
  if (!account) {
    throw new AppError('Account not found.', 404);
  }

  return ok(c, { status: account.status, user: account.user });
});

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

/**
 * Moves the signed-in account onto a different phone number.
 *
 * The body carries the short-lived token `otp/verify` issued for the new
 * number, so the change can only complete for a number the caller just proved
 * they hold. The access token identifies the account being changed; the
 * verification token is finished with once this succeeds, and the account keeps
 * its session because that is keyed by user id, not phone.
 */
usersRoutes.post('/users/me/phone', requireAccessToken, async (c) => {
  const { phone, verification_token } = await readValidatedJson(c, changePhoneSchema);

  const verifiedPhone = await verifyVerificationToken(verification_token);
  if (!verifiedPhone) {
    throw new AppError('Verify your new number to continue.', 401);
  }

  // The token is the authority on which number was verified; a body that names
  // a different one would otherwise move the account onto an unproven number.
  if (verifiedPhone !== phone) {
    throw new AppError('This number does not match the number you verified.', 403, {
      phone: 'Does not match the verified number.',
    });
  }

  const account = await changePhone(c.get('authenticatedUserId'), phone);

  return ok(c, { status: account.status, user: account.user });
});

/**
 * Updates the account's service address: its pin, its ward and street, and the
 * meter it is billed through.
 *
 * All of it arrives together because the three are one answer to "where do we
 * collect from"; the service below makes the profile and the meter record agree
 * rather than letting one drift from the other.
 */
usersRoutes.post('/users/me/site', requireAccessToken, async (c) => {
  const payload = await readValidatedJson(c, updateSiteSchema);

  const account = await updateSite(c.get('authenticatedUserId'), payload);

  return ok(c, { status: account.status, user: account.user });
});

/**
 * Deletes the signed-in account.
 *
 * Everything the profile owns goes with it. The LUKU meter number is released
 * rather than removed: it stays on file with its address so the meter can be
 * registered again, by this person with a new account or by whoever moves in
 * next. The account's phone is cleared from the meter row so nothing links the
 * deleted account back to it.
 */
usersRoutes.delete('/users/me', requireAccessToken, async (c) => {
  const { phone } = await deleteAccount(c.get('authenticatedUserId'));

  // Best-effort, and after the account is already gone: a message that cannot be
  // delivered must not report the deletion as having failed.
  await sendAccountMessage(phone, env.ACCOUNT_DELETED_MESSAGE);

  return ok(c, { deleted: true });
});
