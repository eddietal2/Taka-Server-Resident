import { env } from '../env.js';
import { AppError } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import type {
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
  intent: UserIntent;
  status: UserStatusValue;
  first_name?: string;
  last_name?: string;
  business_name?: string;
  /** Profile picture for residents and reporters, logo for commercial accounts. */
  picture_url?: string;
  /** Chosen app language. Absent until the account picks one. */
  language?: UserLanguage;
  /** Chosen appearance. Absent until the account picks one. */
  theme_preference?: ThemePreference;
};

export type RegistrationOutcome = {
  user: PublicUser;
  status: UserStatusValue;
};

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function createResident(payload: ResidentPayload, status: UserStatusValue) {
  return prisma.user.create({
    data: {
      phone: payload.phone,
      intent: 'RESIDENT',
      status,
      firstName: payload.first_name,
      lastName: payload.last_name,
      resident: {
        create: {
          wardKata: payload.ward_kata,
          streetMtaa: payload.street_mtaa,
          lukuMeter: payload.luku_meter,
          unitNumber: trimmedOrNull(payload.unit_number),
          latitude: payload.location.latitude,
          longitude: payload.location.longitude,
          profilePictureUrl: payload.profile_picture,
        },
      },
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
      reporter: {
        create: {
          profilePictureUrl: payload.profile_picture,
        },
      },
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
  };

  if (payload.intent === 'RESIDENT' || payload.intent === 'REPORTER') {
    publicUser.first_name = payload.first_name;
    publicUser.last_name = payload.last_name;
    publicUser.picture_url = payload.profile_picture;
  }

  if (payload.intent === 'COMMERCIAL') {
    publicUser.business_name = payload.business_name;
    publicUser.picture_url = payload.business_logo;
  }

  return publicUser;
}

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
  resident: { profilePictureUrl: string } | null;
  reporter: { profilePictureUrl: string } | null;
  commercial: { businessName: string; businessLogoUrl: string } | null;
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
  const publicUser: PublicUser = {
    id: user.id,
    phone: user.phone,
    intent: user.intent,
    status: user.status,
  };

  if (user.intent === 'COMMERCIAL') {
    publicUser.business_name = user.commercial?.businessName ?? undefined;
    publicUser.picture_url = user.commercial?.businessLogoUrl ?? undefined;
  } else {
    publicUser.first_name = user.firstName ?? undefined;
    publicUser.last_name = user.lastName ?? undefined;
    publicUser.picture_url =
      (user.intent === 'RESIDENT'
        ? user.resident?.profilePictureUrl
        : user.reporter?.profilePictureUrl) ?? undefined;
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

/** Looks up an existing account by phone, for logging in. */
export async function findSessionUser(
  phone: string
): Promise<{ user: PublicUser; status: UserStatusValue } | null> {
  const user = await prisma.user.findUnique({
    where: { phone },
    include: { resident: true, reporter: true, commercial: true },
  });

  if (!user) return null;

  return { user: toPublicUserFromProfile(user), status: user.status };
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

  return { user: toPublicUserFromProfile(user), status: user.status };
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
