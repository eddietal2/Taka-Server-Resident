import { AppError } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import type { UpdateSitePayload, UpdateUserPayload } from '../schemas/users.js';
import { attachLukuLocation, findMeterClaim, syncLukuAddress } from './luku.js';
import { findUserById, type PublicUser, type UserStatusValue } from './registration.js';

export type UserUpdateOutcome = {
  user: PublicUser;
  status: UserStatusValue;
};

/**
 * Applies a partial update to the signed-in account.
 *
 * Each field lands wherever the active intent says it belongs: the image column
 * differs between residents, reporters and businesses, a business keeps its name
 * and its TIN on its profile while a person keeps theirs on the user row, and
 * language and appearance belong to the account itself because they are not
 * specific to any one type.
 *
 * `intent` is the one field the caller chooses, and only among the roles the
 * account already holds — it selects which profile the rest of the update lands
 * on, so it is written before anything else and the two cannot disagree.
 *
 * The account is read twice — once to learn the current intent, once to return
 * the updated record — because a single query would have to write a column it is
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

  // Switching role is a change of view within one account, not a registration:
  // only a role the account already holds can be selected, so the profile behind
  // it exists. Written first, so every field below lands on the profile that
  // will be active when the caller sees the response.
  if (payload.intent && payload.intent !== account.user.intent) {
    if (!account.user.roles.includes(payload.intent)) {
      throw new AppError('This account does not have that role.', 400, {
        intent: 'Add this role before switching to it.',
      });
    }
    await prisma.user.update({ where: { id: userId }, data: { intent: payload.intent } });
  }

  const activeIntent = payload.intent ?? account.user.intent;
  const isCommercial = activeIntent === 'COMMERCIAL';

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
  if (!isCommercial && payload.tax_id) {
    throw new AppError('This account is registered to a person.', 400, {
      tax_id: 'Only a business account has a TIN.',
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

  // `taxId` is unique on the profile, so a TIN another business already holds
  // surfaces as Prisma P2002 and is mapped to a 409 by the error middleware.
  if (isCommercial && payload.tax_id) {
    await prisma.commercialProfile.update({
      where: { userId },
      data: { taxId: payload.tax_id },
    });
  }

  const pictureUrl = payload.picture_url;
  if (pictureUrl) {
    if (isCommercial) {
      await prisma.commercialProfile.update({
        where: { userId },
        data: { businessLogoUrl: pictureUrl },
      });
    } else if (activeIntent === 'RESIDENT') {
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

/**
 * Moves an account onto a different phone number.
 *
 * The number is taken to be already verified by the route; this only refuses a
 * number another account already holds, then stores it. Uniqueness is checked
 * here rather than left to the column's constraint so the caller gets a field
 * error naming the phone, matching how registration reports a taken number.
 */
export async function changePhone(userId: string, phone: string): Promise<UserUpdateOutcome> {
  const account = await findUserById(userId);
  if (!account) {
    throw new AppError('Account not found.', 404);
  }

  const existing = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  if (existing && existing.id !== userId) {
    throw new AppError('This number is already registered to another account.', 409, {
      phone: 'This number is already registered.',
    });
  }

  await prisma.user.update({ where: { id: userId }, data: { phone } });

  const updated = await findUserById(userId);
  if (!updated) {
    throw new AppError('Account not found.', 404);
  }

  return updated;
}

/**
 * Updates the account's service address: its pin, its ward and street, and the
 * meter it is billed through.
 *
 * The profile and the meter record are made to agree in one call, because a
 * meter carries its own address and the two must not drift: the address on the
 * meter is what a later sign-up for it is seeded with. The old meter, when the
 * account moves off one, is deliberately left behind as a `mapped` row.
 */
export async function updateSite(
  userId: string,
  payload: UpdateSitePayload
): Promise<UserUpdateOutcome> {
  const account = await findUserById(userId);
  if (!account) {
    throw new AppError('Account not found.', 404);
  }

  const { intent, phone } = account.user;
  if (intent === 'REPORTER') {
    throw new AppError('This account has no service address.', 400);
  }
  const isCommercial = intent === 'COMMERCIAL';

  // Omitted means "keep the current meter"; an empty string is a commercial
  // account detaching its meter.
  const currentMeter = account.user.luku_meter ?? null;
  const requestedMeter =
    payload.luku_meter === undefined ? currentMeter : payload.luku_meter || null;

  if (!isCommercial && !requestedMeter) {
    // A resident household is always billed through a meter, so an empty one is
    // refused rather than silently stored.
    throw new AppError('A resident account needs a meter.', 400, {
      luku_meter: 'Enter the meter number.',
    });
  }

  // A meter already on another account cannot be moved here. Asked of the
  // profiles rather than the Luku row, so a meter merely on file still passes.
  if (requestedMeter && requestedMeter !== currentMeter) {
    const holder = await findMeterClaim(requestedMeter);
    if (holder && holder !== phone) {
      throw new AppError('This meter is already registered to another account.', 409, {
        luku_meter: 'Already registered to another account.',
      });
    }
  }

  // Mirror the address onto the meter so a future sign-up for it starts from a
  // real address rather than a stale one. Coordinates and the typed words both
  // go on, matching what registration itself writes.
  if (requestedMeter) {
    await attachLukuLocation({
      meterNumber: requestedMeter,
      phone,
      latitude: payload.location.latitude,
      longitude: payload.location.longitude,
    });
    await syncLukuAddress({
      meterNumber: requestedMeter,
      phone,
      wardKata: payload.ward_kata,
      streetMtaa: payload.street_mtaa.length > 0 ? payload.street_mtaa : null,
    });
  }

  if (isCommercial) {
    await prisma.commercialProfile.update({
      where: { userId },
      data: {
        wardKata: payload.ward_kata,
        streetMtaa: payload.street_mtaa,
        latitude: payload.location.latitude,
        longitude: payload.location.longitude,
        lukuMeter: requestedMeter,
      },
    });
  } else {
    // The guard above already refused an empty meter, so this is a meter number.
    await prisma.residentProfile.update({
      where: { userId },
      data: {
        wardKata: payload.ward_kata,
        streetMtaa: payload.street_mtaa,
        latitude: payload.location.latitude,
        longitude: payload.location.longitude,
        lukuMeter: requestedMeter as string,
      },
    });
  }

  const updated = await findUserById(userId);
  if (!updated) {
    throw new AppError('Account not found.', 404);
  }

  return updated;
}

/**
 * Deletes the account, and with it everything that belongs only to it.
 *
 * The profile rows — and so the picture, the name and the saved address — go
 * with the user, because their foreign keys cascade. The meter record is
 * deliberately kept: it is keyed by its reference number rather than by the
 * account, and it holds the address that was pinned to that meter. With no
 * profile left holding it, it reads as `mapped`, exactly as it does when an
 * account moves off a meter, which is what lets the meter be registered again.
 *
 * The account's phone is cleared from that meter row so a deleted account leaves
 * no link behind. Best-effort in the same transaction as the delete, so the two
 * cannot disagree.
 *
 * The phone is returned so the caller can tell the person their account is gone;
 * it has to be read before the row that holds it is deleted.
 */
export async function deleteAccount(userId: string): Promise<{ phone: string }> {
  const account = await findUserById(userId);
  if (!account) {
    throw new AppError('Account not found.', 404);
  }

  const meter = account.user.luku_meter;
  const phone = account.user.phone;

  if (!meter) {
    await prisma.user.delete({ where: { id: userId } });
    return { phone };
  }

  await prisma.$transaction([
    prisma.luku.updateMany({
      where: { meterNumber: meter, phone },
      data: { phone: null },
    }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  return { phone };
}
