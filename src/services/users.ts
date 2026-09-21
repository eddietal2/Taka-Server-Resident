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
 * Each field lands wherever the stored intent says it belongs, never where the
 * caller says: the image column differs between residents, reporters and
 * businesses, a business keeps its name on its profile while a person keeps
 * theirs on the user row, and language and appearance belong to the account
 * itself because they are not specific to any one type.
 *
 * The account is read twice — once to learn the intent, once to return the
 * updated record — because a single query would have to write a column it is
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

  const isCommercial = account.user.intent === 'COMMERCIAL';

  // Refused rather than dropped: silently ignoring a name that does not fit the
  // account type would answer 200 having changed nothing, which reads as saved.
  if (isCommercial && (payload.first_name || payload.last_name)) {
    throw new AppError('This account is registered to a business.', 400, {
      business_name: 'Business accounts use a business name.',
    });
  }
  if (!isCommercial && payload.business_name) {
    throw new AppError('This account is registered to a person.', 400, {
      first_name: 'Use a first and last name for this account.',
    });
  }

  const accountData: {
    language?: string;
    themePreference?: string;
    firstName?: string;
    lastName?: string;
  } = {};

  if (payload.language) accountData.language = payload.language;
  if (payload.theme_preference) accountData.themePreference = payload.theme_preference;
  if (!isCommercial) {
    if (payload.first_name) accountData.firstName = payload.first_name;
    if (payload.last_name) accountData.lastName = payload.last_name;
  }

  if (Object.keys(accountData).length > 0) {
    await prisma.user.update({ where: { id: userId }, data: accountData });
  }

  if (isCommercial && payload.business_name) {
    await prisma.commercialProfile.update({
      where: { userId },
      data: { businessName: payload.business_name },
    });
  }

  const pictureUrl = payload.picture_url;
  if (pictureUrl) {
    if (isCommercial) {
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
