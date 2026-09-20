import { env } from '../../env.js';
import { AppError } from '../http.js';
import { logger } from '../logger.js';
import type { BillLookupResult, LukuLookupProvider } from '../ntzs.js';

/**
 * Structural stand-ins for the fetch contract, declared locally on purpose.
 *
 * Naming the ambient `Response` type makes this file depend on how `@types/node`
 * re-exports `undici-types`, which does not resolve identically in every build
 * environment. Vercel's type check then fails with "Property 'text' does not
 * exist on type 'Response'" even though a local `tsc --noEmit` passes. Declaring
 * the three members actually used removes that coupling.
 */
export type HttpResponseLike = {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
};

export type FetchInit = {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
};

export type FetchLike = (url: string, init: FetchInit) => Promise<HttpResponseLike>;

function getGlobalFetch(): FetchLike {
  return (globalThis as unknown as { fetch: FetchLike }).fetch;
}

/**
 * Both halves of nTZS's two error shapes, plus the catalogue list that comes back
 * with `unknown_biller`.
 *
 * Most endpoints answer `{ error, message }` (machine code first); identity and
 * KYC paths invert that to `{ error: <sentence>, code: <machine code> }`. The
 * docs are explicit that clients must branch on `code ?? error`, so both are
 * read here.
 */
export type NtzsErrorResponse = {
  error?: string;
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
  supportedCodes?: string[];
};

/** Response of `POST /api/v1/lookup/merchant-name` for a bill account. */
export type NtzsMerchantLookupResponse = NtzsErrorResponse & {
  kind?: string;
  target?: string;
  utilityCode?: string;
  utilityRef?: string;
  /** The registered owner, or null when no confirmation was available. */
  name?: string | null;
  /** Present only when `name` is null. Opaque upstream diagnostic. */
  reason?: string | null;
};

const LOOKUP_PATH = '/api/v1/lookup/merchant-name';

/**
 * Reasons that mean the utility did not answer at all, as opposed to answering
 * and refusing the meter.
 */
const UNAVAILABLE_REASON = /unavailable|timeout|timed[_ ]?out|no_response|no answer|unreachable/i;

/**
 * Upstream diagnostics for a meter the utility looked at and rejected.
 *
 * Observed live on a nonexistent LUKU meter:
 *   reason: "http:400 resultcode:642 message:"
 * The docs' documented reason for "no confirmation" is `lookup_unavailable`,
 * which this deliberately does not match.
 */
const REJECTED_REASON = /resultcode|not[_ ]?found|invalid|unknown|reject|unregistered/i;

export type NtzsBillLookupProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: FetchLike;
};

/** nTZS answers with JSON, but a proxy error page may not be. */
function parseResponse(raw: string): NtzsMerchantLookupResponse {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as NtzsMerchantLookupResponse;
  } catch {
    return {};
  }
}

/**
 * nTZS bill-account lookup, used to resolve a LUKU meter's registered owner.
 *
 * Three characteristics shape this implementation. It authenticates with
 * `Authorization: Bearer <api_key>`; the enquiry is forwarded to the utility and
 * can take ~25s, so it runs behind an AbortController; and it is **fail-soft** —
 * `name: null` means no confirmation was available, which is explicitly not the
 * same as the payment failing, so a null name is returned rather than thrown.
 *
 * Only genuine failures throw: the key is missing, the request never reached
 * nTZS, nTZS refused the key/request, or nTZS is rate limiting us. Those all map
 * to an `AppError` the route can surface without leaking an upstream payload.
 */
export class NtzsBillLookupProvider implements LukuLookupProvider {
  readonly name = 'ntzs';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: NtzsBillLookupProviderOptions = {}) {
    this.apiKey = options.apiKey ?? env.NTZS_API_KEY ?? '';
    this.baseUrl = (options.baseUrl ?? env.NTZS_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? env.NTZS_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? getGlobalFetch();
  }

  /**
   * Resolves the registered owner of a bill account.
   *
   * nTZS also accepts an optional `amountTzs` because biller validation is
   * amount-aware, falling back to the biller's own stated floor when it is
   * absent. Checking a meter for a registration form has no amount to offer, so
   * the lookup sends the bill target alone — the field belongs on a bill-payment
   * quote, which prices against an amount anyway.
   */
  async lookupBill(utilityCode: string, utilityRef: string): Promise<BillLookupResult> {
    if (!this.apiKey) {
      throw new AppError('Meter lookups are not configured on this server.', 503);
    }

    const payloadBody = JSON.stringify({ kind: 'bill', utilityCode, utilityRef });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: HttpResponseLike;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${LOOKUP_PATH}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: payloadBody,
        signal: controller.signal,
      });
    } catch (error) {
      // Meta keys must not be named `message`: that would overwrite the logger's
      // event name field and blank it out. The meter itself is not a secret, so
      // it is logged — that is how a rejected reference gets explained later.
      logger.error('luku.lookup_unreachable', {
        provider: this.name,
        utilityCode,
        utilityRef,
        reason: error instanceof Error ? error.name : 'unknown',
        timeoutMs: this.timeoutMs,
      });
      throw new AppError('We could not check this meter right now. Please try again.', 503);
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text().catch(() => '');
    const payload = parseResponse(raw);

    if (!response.ok) {
      throw this.translateError(response.status, payload, raw, utilityCode);
    }

    const name = typeof payload.name === 'string' && payload.name.trim() !== ''
      ? payload.name.trim()
      : null;
    const reason = typeof payload.reason === 'string' && payload.reason.trim() !== ''
      ? payload.reason.trim()
      : null;
    const target = typeof payload.target === 'string' ? payload.target : null;

    if (name) {
      logger.info('luku.lookup', {
        provider: this.name,
        utilityCode,
        target,
        status: 'active',
      });
      return { status: 'active', ownerName: name, reason: null, target };
    }

    // A null name is fail-soft: an unregistered meter and a utility that is
    // simply down look identical from here. The reason string is what separates
    // them — a biller that answered with a result code looked at the reference
    // and refused it, while an unavailable/timeout reason means no answer at all.
    // Anything unrecognised stays `unconfirmed`, so an unknown diagnostic can
    // never be reported to a resident as "your meter is inactive".
    const rejected = reason !== null && REJECTED_REASON.test(reason) && !UNAVAILABLE_REASON.test(reason);

    logger.warn('luku.lookup', {
      provider: this.name,
      utilityCode,
      target,
      status: rejected ? 'rejected' : 'unconfirmed',
      reason,
    });

    return {
      status: rejected ? 'rejected' : 'unconfirmed',
      ownerName: null,
      reason,
      target,
    };
  }

  /**
   * Turns a non-2xx answer into an AppError. The upstream body is logged and
   * never forwarded: it can embed the biller's own diagnostic, and 401/403 mean
   * our credentials or capability are wrong, which is not the caller's problem
   * to see or retry.
   */
  private translateError(
    status: number,
    payload: NtzsMerchantLookupResponse,
    raw: string,
    utilityCode: string
  ): AppError {
    const code = payload.code ?? payload.error;

    logger.error('luku.lookup_rejected', {
      provider: this.name,
      utilityCode,
      status,
      code,
      // Logged so a credential mismatch is obvious; the API key itself is never
      // logged.
      errorMessage: payload.message,
      body: raw.slice(0, 500),
    });

    if (status === 400) {
      if (code === 'invalid_utility_ref') {
        return new AppError(
          'That meter number was rejected. Check the 11 digits and try again.',
          422,
          { luku_meter: 'Check the meter number.' }
        );
      }

      // Our catalogue drifted from nTZS's: nothing the caller can fix.
      if (code === 'unknown_biller') {
        logger.error('luku.biller_missing', {
          provider: this.name,
          utilityCode,
          supportedCodes: payload.supportedCodes,
        });
        return new AppError('Meter lookups are unavailable right now.', 503);
      }

      return new AppError('That meter number was rejected. Check the 11 digits and try again.', 422, {
        luku_meter: 'Check the meter number.',
      });
    }

    if (status === 429) {
      return new AppError('Too many meter checks right now. Please wait a moment.', 429);
    }

    return new AppError('We could not check this meter right now. Please try again.', 503);
  }
}
