import { AppError } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { findUserById, type PublicUser, type UserStatusValue } from './registration.js';

export type ProfileImageOutcome = {
  user: PublicUser;
  status: UserStatusValue;
};

/**
 * Points the account's image at an already-uploaded object.
 *
 * Which column to write is decided by the intent stored on the account, not by
 * anything the caller sends, so a request cannot aim a resident's picture at a
 * business logo. The account is read twice — once to learn the intent, once to
 * return the updated record — because the two queries want different shapes and
 * a single query would have to write the column it is still deciding.
 */
export async function updateProfileImage(
  userId: string,
  pictureUrl: string
): Promise<ProfileImageOutcome> {
  const account = await findUserById(userId);
  if (!account) {
    throw new AppError('Account not found.', 404);
  }

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

  const updated = await findUserById(userId);
  if (!updated) {
    throw new AppError('Account not found.', 404);
  }

  return updated;
}
