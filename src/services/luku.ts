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
 * Pins GPS coordinates to a meter, creating the row when the lookup came back
 * unconfirmed and so never persisted one. Address parts are written only when
 * supplied, so a capture without a geocode cannot blank a value we already had.
 */
export function attachLukuLocation(input: {
  meterNumber: string;
  phone: string;
  latitude: number;
  longitude: number;
  wardKata?: string;
  streetMtaa?: string;
}) {
  const address = {
    ...(input.wardKata ? { wardKata: input.wardKata } : {}),
    ...(input.streetMtaa ? { streetMtaa: input.streetMtaa } : {}),
  };

  return prisma.luku.upsert({
    where: { meterNumber: input.meterNumber },
    update: {
      phone: input.phone,
      latitude: input.latitude,
      longitude: input.longitude,
      ...address,
    },
    create: {
      meterNumber: input.meterNumber,
      phone: input.phone,
      latitude: input.latitude,
      longitude: input.longitude,
      ...address,
    },
  });
}
