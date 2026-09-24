import { env } from '../env.js';
import { AppError } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import type {
  AddIntentPayload,
  CommercialPayload,
  RegisterPayload,
  ReporterPayload,
  ResidentPayload,
} from '../schemas/auth.js';
import {
  isThemePreference,
  isUserLanguage,
  type ThemePreference,
  type UserLanguage,
} from '../schemas/users.js';
import { findMeterClaim, syncLukuAddress } from './luku.js';

export type UserIntent = 'RESIDENT' | 'REPORTER' | 'COMMERCIAL';
export type UserStatusValue = 'PENDING' | 'ACTIVE' | 'SUSPENDED';

export type PublicUser = {
  id: string;
  phone: string;
  /** The role the account is currently used in. */
  intent: UserIntent;
  status: UserStatusValue;
  /** Every role the account holds; always includes the active `intent`. */
  roles: UserIntent[];
  first_name?: string;
  last_name?: string;
  business_name?: string;
  /** Commercial only: the TIN the business is invoiced under, e.g. 100-234-567. */
  tax_id?: string;
  /** Profile picture for residents and reporters, logo for commercial accounts. */
  picture_url?: string;
  /** Chosen app language. Absent until the account picks one. */
  language?: UserLanguage;
  /** Chosen appearance. Absent until the account picks one. */
  theme_preference?: ThemePreference;
  /** Service address, absent for reporters, who have none. */
  ward_kata?: string;
  street_mtaa?: string;
  location?: { latitude: number; longitude: number };
  /** LUKU meter on file, absent for an account without one. */
  luku_meter?: string;
  /** Registered owner of that meter, when the utility confirmed one. */
  luku_owner_name?: string;
};

export type RegistrationOutcome = {
  user: PublicUser;
  status: UserStatusValue;
};

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The columns a resident profile is written with. Shared by registration and by
 * attaching the role to an existing account, so both write the same shape — and
 * deliberately phone-less, because the account owns the number either way.
 */
function residentProfileData(payload: Omit<ResidentPayload, 'phone'>) {
  return {
    wardKata: payload.ward_kata,
    streetMtaa: payload.street_mtaa,
    lukuMeter: payload.luku_meter,
    unitNumber: trimmedOrNull(payload.unit_number),
    latitude: payload.location.latitude,
    longitude: payload.location.longitude,
    profilePictureUrl: payload.profile_picture,
  };
}

function reporterProfileData(payload: Omit<ReporterPayload, 'phone'>) {
  return { profilePictureUrl: payload.profile_picture };
}

function createResident(payload: ResidentPayload, status: UserStatusValue) {
  return prisma.user.create({
    data: {
      phone: payload.phone,
      intent: 'RESIDENT',
      status,
      firstName: payload.first_name,
      lastName: payload.last_name,
      resident: { create: residentProfileData(payload) },
    },
  });
}

function createReporter(payload: ReporterPayload, status: UserStatusValue) {
  return prisma.user.create({
    data: {
      phone: payload.phone,
      intent: 'REPORTER',
      status,
      firstName: payload.first_name,
      lastName: payload.last_name,
      reporter: { create: reporterProfileData(payload) },
    },
  });
}

function createCommercial(payload: CommercialPayload, status: UserStatusValue) {
  return prisma.user.create({
    data: {
      phone: payload.phone,
      intent: 'COMMERCIAL',
      status,
      commercial: {
        create: {
          businessName: payload.business_name,
          wardKata: payload.ward_kata,
          streetMtaa: payload.street_mtaa,
          latitude: payload.location.latitude,
          longitude: payload.location.longitude,
          lukuMeter: payload.luku_meter
            ? trimmedOrNull(payload.luku_meter)
            : null,
          wasteTier: payload.waste_tier,
          taxId: payload.tax_id,
          businessLogoUrl: payload.business_logo,
        },
      },
    },
  });
}

function toPublicUser(
  user: { id: string; phone: string },
  payload: RegisterPayload,
  status: UserStatusValue
): PublicUser {
  const publicUser: PublicUser = {
    id: user.id,
    phone: user.phone,
    intent: payload.intent,
    status,
    roles: [payload.intent],
  };

  if (payload.intent === 'RESIDENT' || payload.intent === 'REPORTER') {
    publicUser.first_name = payload.first_name;
    publicUser.last_name = payload.last_name;
    publicUser.picture_url = payload.profile_picture;
  }

  if (payload.intent === 'COMMERCIAL') {
    publicUser.business_name = payload.business_name;
    publicUser.tax_id = payload.tax_id;
    publicUser.picture_url = payload.business_logo;
  }

  // The address the sign-up form collected, so the account the client caches is
  // complete without a second read. Reporters have no address or meter.
  if (payload.intent !== 'REPORTER') {
    publicUser.ward_kata = payload.ward_kata;
    publicUser.street_mtaa = payload.street_mtaa;
    publicUser.location = payload.location;
    if (payload.luku_meter) publicUser.luku_meter = payload.luku_meter;
  }

  return publicUser;
}

/** The address columns a resident or commercial profile carries. */
type AddressProfile = {
  wardKata: string;
  streetMtaa: string | null;
  lukuMeter: string | null;
  latitude: number;
  longitude: number;
};

/** A user row with every intent-specific profile loaded. */
type ProfileUser = {
  id: string;
  phone: string;
  intent: UserIntent;
  status: UserStatusValue;
  firstName: string | null;
  lastName: string | null;
  language: string | null;
  themePreference: string | null;
  resident: (AddressProfile & { profilePictureUrl: string }) | null;
  reporter: { profilePictureUrl: string } | null;
  commercial:
    | (AddressProfile & { businessName: string; taxId: string; businessLogoUrl: string })
    | null;
};

/**
 * Shapes a stored account for the client.
 *
 * Unlike `toPublicUser`, which describes the payload the caller just sent, these
 * details come from the database. Residents and reporters keep their picture on
 * their own profile table, while a business stores a logo — all three surface as
 * `picture_url`, so the app has one field to render whatever the account type.
 */
function toPublicUserFromProfile(user: ProfileUser): PublicUser {
  // The roles are read from the profile rows rather than a stored list, so a
  // profile and the roles that name it can never drift apart. The active intent
  // is added back if it somehow has no profile, so it is always held.
  const roles: UserIntent[] = [];
  if (user.resident) roles.push('RESIDENT');
  if (user.reporter) roles.push('REPORTER');
  if (user.commercial) roles.push('COMMERCIAL');
  if (!roles.includes(user.intent)) roles.push(user.intent);

  const publicUser: PublicUser = {
    id: user.id,
    phone: user.phone,
    intent: user.intent,
    status: user.status,
    roles,
  };

  if (user.intent === 'COMMERCIAL') {
    publicUser.business_name = user.commercial?.businessName ?? undefined;
    publicUser.tax_id = user.commercial?.taxId ?? undefined;
    publicUser.picture_url = user.commercial?.businessLogoUrl ?? undefined;
  } else {
    publicUser.first_name = user.firstName ?? undefined;
    publicUser.last_name = user.lastName ?? undefined;
    publicUser.picture_url =
      (user.intent === 'RESIDENT'
        ? user.resident?.profilePictureUrl
        : user.reporter?.profilePictureUrl) ?? undefined;
  }

  // A resident or commercial account carries the service address; a reporter
  // pins nothing and holds no meter, so both stay absent.
  const address = user.intent === 'COMMERCIAL' ? user.commercial : user.resident;
  if (address) {
    publicUser.ward_kata = address.wardKata;
    publicUser.street_mtaa = address.streetMtaa ?? undefined;
    publicUser.location = { latitude: address.latitude, longitude: address.longitude };
    if (address.lukuMeter) publicUser.luku_meter = address.lukuMeter;
  }

  // Narrowed rather than cast: a value written outside the API would otherwise
  // reach the app's translator as an unknown key set and paint blank labels.
  if (isUserLanguage(user.language)) {
    publicUser.language = user.language;
  }
  if (isThemePreference(user.themePreference)) {
    publicUser.theme_preference = user.themePreference;
  }

  return publicUser;
}

/**
 * Adds the registered owner of the account's meter, when one is on file.
 *
 * The owner lives on the meter record rather than on the profile, and it is only
 * informational, so it is looked up after the profile is shaped rather than
 * joined into the account query.
 */
async function attachLukuOwner(publicUser: PublicUser): Promise<PublicUser> {
  if (!publicUser.luku_meter) return publicUser;

  const meter = await prisma.luku.findUnique({
    where: { meterNumber: publicUser.luku_meter },
    select: { ownerName: true },
  });

  if (meter?.ownerName) publicUser.luku_owner_name = meter.ownerName;
  return publicUser;
}

/** Looks up an existing account by phone, for logging in. */
export async function findSessionUser(
  phone: string
): Promise<{ user: PublicUser; status: UserStatusValue } | null> {
  const user = await prisma.user.findUnique({
    where: { phone },
    include: { resident: true, reporter: true, commercial: true },
  });

  if (!user) return null;

  return { user: await attachLukuOwner(toPublicUserFromProfile(user)), status: user.status };
}

/** The same shape, looked up by id, for a caller holding an access token. */
export async function findUserById(
  userId: string
): Promise<{ user: PublicUser; status: UserStatusValue } | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { resident: true, reporter: true, commercial: true },
  });

  if (!user) return null;

  return { user: await attachLukuOwner(toPublicUserFromProfile(user)), status: user.status };
}

/**
 * The phone number on an account, for middleware that holds only an access
 * token. Deliberately a projection rather than `findUserById`: gating a meter
 * enquiry should not load three profile tables.
 */
export async function findUserPhoneById(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
  return user?.phone ?? null;
}

/**
 * Copies the typed ward and street onto the meter record.
 *
 * Best-effort: the account exists by this point, and a meter that cannot be
 * annotated must not turn a successful registration into an error.
 */
async function syncMeterAddress(
  meterNumber: string,
  phone: string,
  wardKata: string,
  streetMtaa: string
): Promise<void> {
  try {
    await syncLukuAddress({
      meterNumber,
      phone,
      wardKata,
      streetMtaa: trimmedOrNull(streetMtaa),
    });
  } catch (error) {
    logger.warn('luku.address_sync_failed', {
      reason: error instanceof Error ? error.name : 'unknown',
    });
  }
}

/**
 * Creates the User and its intent-specific profile. Uniqueness violations
 * (phone, luku_meter, tax_id) surface as Prisma P2002 and are mapped to a 409
 * by the error middleware.
 */
export async function createRegistration(payload: RegisterPayload): Promise<RegistrationOutcome> {
  const status: UserStatusValue = env.REGISTRATION_AUTO_APPROVE ? 'ACTIVE' : 'PENDING';

  const existing = await prisma.user.findUnique({ where: { phone: payload.phone } });
  if (existing) {
    throw new AppError('This number is already registered. Try logging in instead.', 409, {
      phone: 'This number is already registered.',
    });
  }

  // A meter may be held by one account only. Each profile table is unique on its
  // own `lukuMeter`, so the databases catch a duplicate within a table; the
  // cross-table case — a business claiming a household's meter, or the reverse —
  // is only visible here. The app already blocks this on the meter step, so this
  // is the backstop for a caller that skips that step.
  const meter = payload.intent === 'REPORTER' ? null : payload.luku_meter ?? null;
  if (meter) {
    const holder = await findMeterClaim(meter);
    // A claim by this same number cannot reach here — that phone would already
    // exist as a User and be rejected above — but comparing keeps the more
    // accurate error if that guard ever moves.
    if (holder && holder !== payload.phone) {
      throw new AppError('This meter is already registered to another account.', 409, {
        luku_meter: 'Already registered to another account.',
      });
    }
  }

  if (payload.intent === 'RESIDENT') {
    const user = await createResident(payload, status);
    await syncMeterAddress(
      payload.luku_meter,
      payload.phone,
      payload.ward_kata,
      payload.street_mtaa
    );
    return { user: toPublicUser(user, payload, status), status };
  }

  if (payload.intent === 'REPORTER') {
    const user = await createReporter(payload, status);
    return { user: toPublicUser(user, payload, status), status };
  }

  const user = await createCommercial(payload, status);
  // A business may register without a meter; only annotate one it actually has.
  if (payload.luku_meter) {
    await syncMeterAddress(
      payload.luku_meter,
      payload.phone,
      payload.ward_kata,
      payload.street_mtaa
    );
  }
  return { user: toPublicUser(user, payload, status), status };
}

/**
 * Attaches a second role's profile to an account that already exists.
 *
 * The account is identified by its access token, so the number is never taken
 * from the payload and the `User` row — its phone, its name and its preferences
 * — is left untouched. Only the missing profile row is created, and the new role
 * is made active so the caller lands in the flow it just completed. The response
 * carries the whole account, so the app can store what the server now holds.
 */
export async function addIntentToUser(
  userId: string,
  payload: AddIntentPayload
): Promise<RegistrationOutcome> {
  const account = await findUserById(userId);
  if (!account) {
    throw new AppError('Account not found.', 404);
  }

  if (account.user.roles.includes(payload.intent)) {
    throw new AppError('This account already has that role.', 409, {
      intent: 'This account already has that role.',
    });
  }

  if (payload.intent === 'RESIDENT') {
    // The same cross-table meter guard registration applies: a meter held by any
    // other account cannot be claimed here. A claim by this account cannot exist
    // because it would already own the resident role, which was refused above.
    const holder = await findMeterClaim(payload.luku_meter);
    if (holder && holder !== account.user.phone) {
      throw new AppError('This meter is already registered to another account.', 409, {
        luku_meter: 'Already registered to another account.',
      });
    }

    await prisma.residentProfile.create({
      data: { userId, ...residentProfileData(payload) },
    });
    await syncMeterAddress(
      payload.luku_meter,
      account.user.phone,
      payload.ward_kata,
      payload.street_mtaa
    );
  } else {
    await prisma.reporterProfile.create({
      data: { userId, ...reporterProfileData(payload) },
    });
  }

  // The role becomes active, and the name travels with it: it lives on the
  // account rather than on either profile, and it is the same person either way,
  // so the copy the wizard collected updates it instead of being discarded.
  // Both attachable roles carry a name; a business role later would not.
  await prisma.user.update({
    where: { id: userId },
    data: {
      intent: payload.intent,
      firstName: payload.first_name,
      lastName: payload.last_name,
    },
  });

  const updated = await findUserById(userId);
  if (!updated) {
    throw new AppError('Account not found.', 404);
  }

  return updated;
}
