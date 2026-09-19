import { describe, expect, it, vi } from 'vitest';

import { AfricasTalkingOtpProvider } from '../src/lib/providers/africastalking';

const PHONE = '+255712345678';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function acceptedResponse(): Response {
  return jsonResponse({
    SMSMessageData: {
      Message: 'Sent to 1/1 Total Cost: TZS 0.0000',
      Recipients: [
        {
          statusCode: 101,
          number: PHONE,
          cost: 'TZS 0.0000',
          status: 'Success',
          messageId: 'ATXid_1',
        },
      ],
    },
  });
}

function providerWith(fetchImpl: typeof fetch, senderId?: string): AfricasTalkingOtpProvider {
  return new AfricasTalkingOtpProvider({
    username: 'sandbox',
    apiKey: 'test-api-key',
    senderId,
    endpoint: 'https://example.test/version1/messaging',
    fetchImpl,
  });
}

describe('AfricasTalkingOtpProvider', () => {
  it('posts a form-encoded body with the apiKey header', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(acceptedResponse());

    await providerWith(fetchImpl).send(PHONE, '123456');

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.test/version1/messaging');
    expect(init.method).toBe('POST');

    const headers = init.headers as unknown as Record<string, string>;
    expect(headers.apiKey).toBe('test-api-key');
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const params = new URLSearchParams(String(init.body));
    expect(params.get('username')).toBe('sandbox');
    expect(params.get('to')).toBe('+255712345678');
    expect(params.get('message')).toContain('123456');
  });

  it('includes from only when a sender ID is configured', async () => {
    const withSender = vi.fn<typeof fetch>().mockResolvedValue(acceptedResponse());
    await providerWith(withSender, 'TAKA').send(PHONE, '123456');

    const withInit = withSender.mock.calls[0][1] as RequestInit;
    expect(new URLSearchParams(String(withInit.body)).get('from')).toBe('TAKA');

    const withoutSender = vi.fn<typeof fetch>().mockResolvedValue(acceptedResponse());
    await providerWith(withoutSender).send(PHONE, '123456');

    const withoutInit = withoutSender.mock.calls[0][1] as RequestInit;
    expect(new URLSearchParams(String(withoutInit.body)).has('from')).toBe(false);
  });

  it('accepts Queued and Processed recipients', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        SMSMessageData: {
          Recipients: [{ statusCode: 102, status: 'Queued', messageId: 'ATXid_2' }],
        },
      })
    );

    await expect(providerWith(fetchImpl).send(PHONE, '123456')).resolves.toBeUndefined();
  });

  it('rejects with a 503 when a recipient reports a failure status code', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        SMSMessageData: {
          Message: 'Sent to 0/1',
          Recipients: [{ statusCode: 405, status: 'InsufficientBalance' }],
        },
      })
    );

    await expect(providerWith(fetchImpl).send(PHONE, '123456')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('rejects with a 503 when no recipients are returned', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ SMSMessageData: { Message: 'Sent to 0/0', Recipients: [] } })
    );

    await expect(providerWith(fetchImpl).send(PHONE, '123456')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('rejects with a 503 when the HTTP status is not ok', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ errorMessage: 'Invalid apiKey' }, 401));

    await expect(providerWith(fetchImpl).send(PHONE, '123456')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('rejects with a 503 when the network throws', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('ENOTFOUND'));

    await expect(providerWith(fetchImpl).send(PHONE, '123456')).rejects.toMatchObject({
      status: 503,
    });
  });
});
