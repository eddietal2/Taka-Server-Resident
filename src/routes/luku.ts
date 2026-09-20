import { Hono } from 'hono';

import { ok } from '../lib/http.js';
import { getLukuLookupProvider } from '../lib/ntzs.js';
import { readValidatedJson } from '../lib/validate.js';
import { requireVerificationToken } from '../middleware/auth.js';
import { LUKU_UTILITY_CODE, lukuLookupSchema } from '../schemas/luku.js';
import type { AppEnv } from '../types.js';

export const lukuRoutes = new Hono<AppEnv>();

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
 */
lukuRoutes.post('/luku/lookup', requireVerificationToken, async (c) => {
  const { luku_meter } = await readValidatedJson(c, lukuLookupSchema);

  const outcome = await getLukuLookupProvider().lookupBill(LUKU_UTILITY_CODE, luku_meter);

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
    owner_name: outcome.ownerName,
    /** Upstream diagnostic, set only when `owner_name` is null. Not for display. */
    reason: outcome.reason,
    checked_at: new Date().toISOString(),
  });
});
