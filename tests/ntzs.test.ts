import { describe, expect, it, vi } from 'vitest';

import {
  NtzsBillLookupProvider,
  type FetchInit,
  type FetchLike,
  type HttpResponseLike,
} from '../src/lib/providers/ntzs';

const METER = '01234567890';

function jsonResponse(body: unknown, status = 200): HttpResponseLike {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** What nTZS answers for a resolved LUKU meter. */
function resolvedResponse(): HttpResponseLike {
  return jsonResponse({
    kind: 'bill',
    target: `bill:LUKU:${METER}`,
    utilityCode: 'LUKU',
    utilityRef: METER,
    name: 'JOHN DOE',
  });
}

function providerWith(fetchImpl: FetchLike, timeoutMs = 30_000): NtzsBillLookupProvider {
  return new NtzsBillLookupProvider({
    apiKey: 'test-api-key',
    // Trailing slash is intentional: baseUrl normalisation is part of the contract.
    baseUrl: 'https://example.test/',
    timeoutMs,
    fetchImpl,
  });
}

describe('NtzsBillLookupProvider', () => {
  it('posts the bill target with the bearer key', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(resolvedResponse());

    const result = await providerWith(fetchImpl).lookupBill('LUKU', METER);

    expect(result).toEqual({
      status: 'active',
      ownerName: 'JOHN DOE',
      reason: null,
      target: `bill:LUKU:${METER}`,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as [string, FetchInit];
    expect(url).toBe('https://example.test/api/v1/lookup/merchant-name');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-api-key');
    expect(init.headers['Content-Type']).toBe('application/json');
    // toEqual is exact, so this also pins that no amountTzs is sent: the lookup
    // only identifies the meter and lets the biller use its own stated floor.
    expect(JSON.parse(init.body)).toEqual({
      kind: 'bill',
      utilityCode: 'LUKU',
      utilityRef: METER,
    });
  });

  it('reports unconfirmed when the utility gives no answer', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        kind: 'bill',
        target: `bill:LUKU:${METER}`,
        utilityCode: 'LUKU',
        utilityRef: METER,
        name: null,
        reason: 'lookup_unavailable',
      })
    );

    await expect(providerWith(fetchImpl).lookupBill('LUKU', METER)).resolves.toEqual({
      status: 'unconfirmed',
      ownerName: null,
      reason: 'lookup_unavailable',
      target: `bill:LUKU:${METER}`,
    });
  });

  it('reports rejected when the biller answered and refused the meter', async () => {
    // Observed live for a LUKU meter the utility does not know about.
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        kind: 'bill',
        target: `bill:LUKU:${METER}`,
        name: null,
        reason: 'http:400 resultcode:642 message:',
      })
    );

    await expect(providerWith(fetchImpl).lookupBill('LUKU', METER)).resolves.toMatchObject({
      status: 'rejected',
      ownerName: null,
    });
  });

  it('treats an unrecognised reason as unconfirmed, never as a rejected meter', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({ name: null, reason: 'http:502 upstream exploded' })
    );

    await expect(providerWith(fetchImpl).lookupBill('LUKU', METER)).resolves.toMatchObject({
      status: 'unconfirmed',
    });
  });

  it('treats a 200 with no payload as unconfirmed', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({}));

    await expect(providerWith(fetchImpl).lookupBill('LUKU', METER)).resolves.toEqual({
      status: 'unconfirmed',
      ownerName: null,
      reason: null,
      target: null,
    });
  });

  it('maps invalid_utility_ref to a 422 against the meter field', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValue(
        jsonResponse({ error: 'invalid_utility_ref', message: 'Meter No must be exactly 11 digits' }, 400)
      );

    await expect(providerWith(fetchImpl).lookupBill('LUKU', METER)).rejects.toMatchObject({
      status: 422,
      errors: { luku_meter: expect.any(String) },
    });
  });

  it('maps an unexpected 400 to a 422 rather than leaking the upstream body', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValue(jsonResponse({ error: 'bad_request', message: 'internal detail' }, 400));

    await expect(providerWith(fetchImpl).lookupBill('LUKU', METER)).rejects.toMatchObject({
      status: 422,
      message: expect.not.stringContaining('internal detail'),
    });
  });

  it('maps unknown_biller to a 503: our catalogue drifted, not the caller', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse(
        {
          error: 'unknown_biller',
          message: "utilityCode 'LUKU' is not in the biller catalogue.",
          supportedCodes: ['TOP', 'TUKUZA'],
        },
        400
      )
    );

    await expect(providerWith(fetchImpl).lookupBill('LUKU', METER)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('surfaces nTZS rate limiting as a 429', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValue(jsonResponse({ error: 'rate_limited' }, 429));

    await expect(providerWith(fetchImpl).lookupBill('LUKU', METER)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('hides credential failures behind a 503', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValue(
        jsonResponse({ error: 'Missing or invalid Authorization header. Expected: Bearer <api_key>' }, 401)
      );

    await expect(providerWith(fetchImpl).lookupBill('LUKU', METER)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('rejects with a 503 when the network throws', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockRejectedValue(new Error('ENOTFOUND'));

    await expect(providerWith(fetchImpl).lookupBill('LUKU', METER)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('aborts a slow enquiry and answers 503 instead of hanging', async () => {
    const fetchImpl = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise<never>((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );

    await expect(providerWith(fetchImpl, 5).lookupBill('LUKU', METER)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('refuses to call out when no key is configured', async () => {
    const fetchImpl = vi.fn<FetchLike>();

    const provider = new NtzsBillLookupProvider({ apiKey: '', fetchImpl });

    await expect(provider.lookupBill('LUKU', METER)).rejects.toMatchObject({
      status: 503,
      message: 'Meter lookups are not configured on this server.',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
