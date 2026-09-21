import { AppError } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import type { UpdateUserPayload } from '../schemas/users.js';
import { findUserById, type PublicUser, type UserStatusValue } from './registration.js';

export type UserUpdateOutcome = {
  user: PublicUser;
  status: UserStatusValue;
};

/**
 * Applies a partial update to the signed-in account.
 *
 * Which image column to write is decided by the intent stored on the account,
 * not by anything the caller sends, so a request cannot aim a resident's picture
 * at a business logo. Language and appearance live on the account itself rather
 * than on a profile, because they are not specific to any one account type.
 *
 * The account is read twice — once to learn the intent, once to return the
 * updated record — because a single query would have to write the column it is
 * still deciding.
 */
export async function updateUser(
  userId: string,
  payload: UpdateUserPayload
): Promise<UserUpdateOutcome> {
  const account = await findUserById(userId);
  if (!account) {
    throw new AppError('Account not found.', 404);
  }

  const preferences: { language?: string; themePreference?: string } = {};
  if (payload.language) preferences.language = payload.language;
  if (payload.theme_preference) preferences.themePreference = payload.theme_preference;

  if (Object.keys(preferences).length > 0) {
    await prisma.user.update({ where: { id: userId }, data: preferences });
  }

  const pictureUrl = payload.picture_url;
  if (pictureUrl) {
    if (account.user.intent === 'COMMERCIAL') {
      await prisma.commercialProfile.update({
        where: { userId },
        data: { businessLogoUrl: pictureUrl },
      });
    } else if (account.user.intent === 'RESIDENT') {
      await prisma.residentProfile.update({
        where: { userId },
        data: { profilePictureUrl: pictureUrl },
      });
    } else {
      await prisma.reporterProfile.update({
        where: { userId },
        data: { profilePictureUrl: pictureUrl },
      });
    }
  }

  const updated = await findUserById(userId);
  if (!updated) {
    throw new AppError('Account not found.', 404);
  }

  return updated;
}
