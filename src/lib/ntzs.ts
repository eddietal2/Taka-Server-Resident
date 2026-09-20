import { NtzsBillLookupProvider } from './providers/ntzs.js';

/**
 * How a meter enquiry ended.
 *
 * - `active` — the utility returned a registered owner, so the meter exists.
 * - `rejected` — the utility answered and refused the reference (unknown or
 *   inactive meter). This is the only state that justifies telling a resident
 *   the meter is not usable.
 * - `unconfirmed` — nothing came back: the utility was slow, down, or gave no
 *   answer. nTZS documents this as a normal outcome that must never block a
 *   flow, so it is deliberately not reported as "inactive".
 */
export type BillLookupStatus = 'active' | 'rejected' | 'unconfirmed';

export type BillLookupResult = {
  status: BillLookupStatus;
  /** Registered owner, or null when no confirmation was available. */
  ownerName: string | null;
  /** Opaque upstream diagnostic; only ever set when `ownerName` is null. */
  reason: string | null;
  /** nTZS's own target key, e.g. `bill:LUKU:01234567890`. */
  target: string | null;
};

/**
 * Name-resolution adapter. Today only biller accounts are needed (LUKU meters);
 * the interface keeps the route free of the HTTP shape and lets the registry be
 * swapped or stubbed in tests.
 */
export interface LukuLookupProvider {
  readonly name: string;
  lookupBill(utilityCode: string, utilityRef: string): Promise<BillLookupResult>;
}

let cachedProvider: LukuLookupProvider | null = null;

/** Resolves the lookup adapter, memoized per process. */
export function getLukuLookupProvider(): LukuLookupProvider {
  if (!cachedProvider) {
    cachedProvider = new NtzsBillLookupProvider();
  }
  return cachedProvider;
}

/** Test seam: drops the memoized adapter. */
export function resetLukuLookupProvider(): void {
  cachedProvider = null;
}
