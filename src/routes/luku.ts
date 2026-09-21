import { Hono } from 'hono';

import { AppError, ok } from '../lib/http.js';
import { getLukuLookupProvider } from '../lib/ntzs.js';
import { readValidatedJson } from '../lib/validate.js';
import { requireVerificationToken } from '../middleware/auth.js';
import { LUKU_UTILITY_CODE, lukuLocationSchema, lukuLookupSchema } from '../schemas/luku.js';
import {
  attachLukuLocation,
  findLuku,
  isMeterRegistered,
  recordLukuLookup,
} from '../services/luku.js';
import type { AppEnv } from '../types.js';

export const lukuRoutes = new Hono<AppEnv>();

/**
 * Guards that the number in the body is the one the token proves, mirroring the
 * register handlers: a caller must not be able to run an enquiry for a number
 * they have not just verified.
 */
function assertVerifiedPhone(verified: string, claimed: string): void {
  if (claimed !== verified) {
    throw new AppError('This number does not match the number you verified.', 403, {
      phone: 'Does not match the verified number.',
    });
  }
}

/** The address already pinned to a meter, when one has been captured before. */
function storedAddress(record: Awaited<ReturnType<typeof findLuku>>) {
  const hasPoint = record?.latitude !== null && record?.longitude !== null;

  return {
    ward_kata: record?.wardKata ?? null,
    street_mtaa: record?.streetMtaa ?? null,
    location:
      record && hasPoint
        ? { latitude: record.latitude as number, longitude: record.longitude as number }
        : null,
  };
}

/**
 * Resolves a LUKU meter's registered owner and whether the meter is live, so the
 * app can confirm the number before a resident commits it to their profile.
 *
 * Gated on the verification token for two reasons: the app only has a meter
 * number to check once the resident has verified their phone, and nTZS bills
 * every lookup as an audited enquiry against the utility, rate limits it to
 * 60/min per partner and treats bulk use as enumeration — an open endpoint would
 * be a relay into the utility's registry.
 *
 * Latency: the enquiry is forwarded to the utility and can take ~25s. The app
 * must debounce (never call this per keystroke) and show a spinner.
 *
 * A confirmed meter is written to the Luku table on the way out, so the location
 * step and any later sign-up for the same meter start from what is already on
 * file.
 */
lukuRoutes.post('/luku/lookup', requireVerificationToken, async (c) => {
  const { phone, luku_meter } = await readValidatedJson(c, lukuLookupSchema);
  assertVerifiedPhone(c.get('verificationPhone'), phone);

  const outcome = await getLukuLookupProvider().lookupBill(LUKU_UTILITY_CODE, luku_meter);

  // Only a confirmed owner creates a record. An unconfirmed enquiry is a normal
  // upstream outcome, and persisting it would leave a row that later reads as a
  // real meter.
  const record = outcome.ownerName
    ? await recordLukuLookup({ meterNumber: luku_meter, phone, ownerName: outcome.ownerName })
    : await findLuku(luku_meter);

  // Asked after the enquiry, so a deployment without nTZS credentials still
  // fails on the enquiry rather than on a database read.
  const alreadyRegistered = await isMeterRegistered(luku_meter);

  return ok(c, {
    luku_meter,
    utility_code: LUKU_UTILITY_CODE,
    /** `active` | `rejected` | `unconfirmed` — see BillLookupStatus. */
    status: outcome.status,
    /**
     * Tri-state on purpose. `null` means the utility did not answer, which nTZS
     * documents as a normal outcome: rendering that as `false` would tell a
     * resident their working meter is dead every time the biller is slow.
     */
    active: outcome.status === 'active' ? true : outcome.status === 'rejected' ? false : null,
    owner_name: outcome.ownerName ?? record?.ownerName ?? null,
    /**
     * True when this meter already belongs to a Taka account. The app warns on
     * the location step, because registration will refuse the duplicate meter.
     */
    already_registered: alreadyRegistered,
    /** Address already on file for this meter, so the location step can reuse it. */
    ...storedAddress(record),
    /** Upstream diagnostic, set only when `owner_name` is null. Not for display. */
    reason: outcome.reason,
    checked_at: new Date().toISOString(),
  });
});

/**
 * Pins the resident's GPS point to the LUKU reference number, which is what
 * later collections are matched against. Called from the location step, which
 * runs after the lookup, so the meter usually has a row already; the upsert
 * covers the unconfirmed case where the lookup never created one.
 *
 * Coordinates only — the typed ward and street are attached at registration.
 */
lukuRoutes.post('/luku/location', requireVerificationToken, async (c) => {
  const payload = await readValidatedJson(c, lukuLocationSchema);
  assertVerifiedPhone(c.get('verificationPhone'), payload.phone);

  const record = await attachLukuLocation({
    meterNumber: payload.luku_meter,
    phone: payload.phone,
    latitude: payload.location.latitude,
    longitude: payload.location.longitude,
  });

  return ok(c, {
    luku_meter: record.meterNumber,
    owner_name: record.ownerName,
    ward_kata: record.wardKata,
    street_mtaa: record.streetMtaa,
    location:
      record.latitude !== null && record.longitude !== null
        ? { latitude: record.latitude, longitude: record.longitude }
        : null,
    updated_at: record.updatedAt.toISOString(),
  });
});
