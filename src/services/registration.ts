import { env } from '../env.js';
import { AppError } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import type {
  CommercialPayload,
  RegisterPayload,
  ReporterPayload,
  ResidentPayload,
} from '../schemas/auth.js';

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

/**
 * Looks up an existing account by phone, for logging in.
 *
 * Unlike `toPublicUser`, which describes the payload the caller just sent, the
 * profile details here come from the database.
 */
export async function findSessionUser(
  phone: string
): Promise<{ user: PublicUser; status: UserStatusValue } | null> {
  const user = await prisma.user.findUnique({
    where: { phone },
    include: { resident: true, reporter: true, commercial: true },
  });

  if (!user) return null;

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

  return { user: publicUser, status: user.status };
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

  if (payload.intent === 'RESIDENT') {
    const user = await createResident(payload, status);
    return { user: toPublicUser(user, payload, status), status };
  }

  if (payload.intent === 'REPORTER') {
    const user = await createReporter(payload, status);
    return { user: toPublicUser(user, payload, status), status };
  }

  const user = await createCommercial(payload, status);
  return { user: toPublicUser(user, payload, status), status };
}
