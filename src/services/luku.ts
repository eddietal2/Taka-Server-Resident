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
 * The phone of the account already holding the meter, or null when no account
 * does.
 *
 * Both profile tables are checked because a meter can legitimately belong to a
 * household or a business, and the unique constraints live per table — so only
 * an application check can see the cross-table case. Deliberately asked of the
 * profiles rather than the `Luku` row: a row created moments ago by the lookup
 * in this very flow is not an existing registration, and deleting that row does
 * not free the meter.
 */
export async function findMeterClaim(meterNumber: string): Promise<string | null> {
  const [resident, commercial] = await Promise.all([
    prisma.residentProfile.findUnique({
      where: { lukuMeter: meterNumber },
      select: { user: { select: { phone: true } } },
    }),
    prisma.commercialProfile.findFirst({
      where: { lukuMeter: meterNumber },
      select: { user: { select: { phone: true } } },
    }),
  ]);

  return resident?.user.phone ?? commercial?.user.phone ?? null;
}

/**
 * What the database already knows about a meter, as the app needs it:
 *
 * - `claimed` — a live account holds the meter, so it cannot be registered again.
 * - `mapped` — the meter is on file with an address but no account claims it. The
 *   leftover row when someone re-pointed their profile at a new meter or deleted
 *   their account; the address is still worth reusing.
 * - `new` — neither: a meter the database has never seen.
 */
export type MeterState = 'new' | 'claimed' | 'mapped';

/**
 * Classifies a meter. Pure so the decision can be tested without a database.
 *
 * A claim outranks a saved address: once an account holds the meter the address
 * it also carries is moot, because the sign-up will be refused either way.
 */
export function classifyMeter(input: {
  claimedByAccount: boolean;
  hasSavedAddress: boolean;
}): MeterState {
  if (input.claimedByAccount) return 'claimed';
  return input.hasSavedAddress ? 'mapped' : 'new';
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
