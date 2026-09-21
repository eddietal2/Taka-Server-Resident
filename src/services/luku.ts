import { prisma } from '../lib/prisma.js';

/**
 * The meter record that survives sign-up. It is keyed by `meterNumber` and
 * owned by the lookup flow rather than the profile tables: a resident resolves
 * their meter before an account exists, and the location step pins coordinates
 * to the same reference number instead of to a user.
 */

/** Reads a meter already on file, or null when it has never been looked up. */
export function findLuku(meterNumber: string) {
  return prisma.luku.findUnique({ where: { meterNumber } });
}

/**
 * Records a confirmed meter. Only called once the utility returned an owner, so
 * the stored owner is never blank; an existing row keeps its attached address.
 */
export function recordLukuLookup(input: {
  meterNumber: string;
  phone: string;
  ownerName: string;
}) {
  return prisma.luku.upsert({
    where: { meterNumber: input.meterNumber },
    update: { phone: input.phone, ownerName: input.ownerName },
    create: {
      meterNumber: input.meterNumber,
      phone: input.phone,
      ownerName: input.ownerName,
    },
  });
}

/**
 * Whether the meter is already bound to a Taka account.
 *
 * Both profile tables are checked: `lukuMeter` is unique on each, but a meter
 * can legitimately belong to a household or a business, and the caller only
 * needs to know that *some* account holds it. Deliberately asked of the profiles
 * rather than the `Luku` row — a row created moments ago by the lookup in this
 * very flow is not an existing registration.
 */
export async function isMeterRegistered(meterNumber: string): Promise<boolean> {
  const [resident, commercial] = await Promise.all([
    prisma.residentProfile.findUnique({
      where: { lukuMeter: meterNumber },
      select: { id: true },
    }),
    prisma.commercialProfile.findFirst({
      where: { lukuMeter: meterNumber },
      select: { id: true },
    }),
  ]);

  return Boolean(resident ?? commercial);
}

/**
 * Pins GPS coordinates to a meter, creating the row when the lookup came back
 * unconfirmed and so never persisted one.
 *
 * Deliberately coordinates-only. The ward and street are written by
 * `syncLukuAddress` at registration, because the reverse geocoder's "street" is
 * often the ward's name echoed back, and the location step runs before the
 * resident has typed anything.
 */
export function attachLukuLocation(input: {
  meterNumber: string;
  phone: string;
  latitude: number;
  longitude: number;
}) {
  return prisma.luku.upsert({
    where: { meterNumber: input.meterNumber },
    update: {
      phone: input.phone,
      latitude: input.latitude,
      longitude: input.longitude,
    },
    create: {
      meterNumber: input.meterNumber,
      phone: input.phone,
      latitude: input.latitude,
      longitude: input.longitude,
    },
  });
}

/**
 * Writes the address the resident typed onto the meter.
 *
 * Called at registration — the first point at which the ward and street exist as
 * words a human chose, rather than as whatever the geocoder guessed. The values
 * are written as submitted: an empty street clears the column, so the record
 * always reflects the claim that was just made for the meter.
 */
export function syncLukuAddress(input: {
  meterNumber: string;
  phone: string;
  wardKata: string;
  streetMtaa: string | null;
}) {
  return prisma.luku.upsert({
    where: { meterNumber: input.meterNumber },
    update: {
      phone: input.phone,
      wardKata: input.wardKata,
      streetMtaa: input.streetMtaa,
    },
    create: {
      meterNumber: input.meterNumber,
      phone: input.phone,
      wardKata: input.wardKata,
      streetMtaa: input.streetMtaa,
    },
  });
}
