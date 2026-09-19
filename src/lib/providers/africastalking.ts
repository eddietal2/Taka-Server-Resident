import { env } from '../../env';
import { AppError } from '../http';
import { logger } from '../logger';
import { maskPhone } from '../phone';
import type { OtpProvider } from '../otp';

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

/** One entry from `SMSMessageData.Recipients`. */
export type AtRecipient = {
  statusCode?: number;
  number?: string;
  cost?: string;
  status?: string;
  messageId?: string;
};

export type AtSendResponse = {
  SMSMessageData?: {
    Message?: string;
    Recipients?: AtRecipient[];
  };
  /** Present on authentication and request errors. */
  errorMessage?: string;
};

/**
 * Africa's Talking reports a per-recipient status code. Processed (100),
 * Sent (101) and Queued (102) all mean the message was accepted; anything else
 * is a failure such as InvalidSenderId (402) or InsufficientBalance (405).
 */
const ACCEPTED_STATUS_CODES = new Set([100, 101, 102]);

export type AfricasTalkingOtpProviderOptions = {
  username?: string;
  apiKey?: string;
  senderId?: string;
  endpoint?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: FetchLike;
};

function renderMessage(code: string, minutes: number): string {
  return env.OTP_MESSAGE_TEMPLATE.replace(/\{\{code\}\}/g, code).replace(
    /\{\{minutes\}\}/g,
    String(minutes)
  );
}

/** Africa's Talking answers with JSON, but a proxy error page may not be. */
function parseResponse(raw: string): AtSendResponse {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as AtSendResponse;
  } catch {
    return {};
  }
}

/**
 * Africa's Talking SMS adapter.
 *
 * Three characteristics shape this implementation: it authenticates with an
 * `apiKey` header, it expects a form-encoded body rather than JSON, and it
 * reports per-recipient outcomes under `SMSMessageData.Recipients`. Phones are
 * passed as stored (`+255XXXXXXXXX`), since Africa's Talking expects E.164 with
 * the leading plus.
 *
 * The sandbox host simulates delivery rather than sending real messages, so
 * `AT_SMS_ENDPOINT` must point at the production host outside development; the
 * environment validation rejects the sandbox host when NODE_ENV is production.
 */
export class AfricasTalkingOtpProvider implements OtpProvider {
  readonly name = 'africastalking';

  private readonly username: string;
  private readonly apiKey: string;
  private readonly senderId: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: AfricasTalkingOtpProviderOptions = {}) {
    this.username = options.username ?? env.AT_USERNAME ?? '';
    this.apiKey = options.apiKey ?? env.AT_API_KEY ?? '';
    this.senderId = options.senderId ?? env.AT_SENDER_ID ?? '';
    this.endpoint = options.endpoint ?? env.AT_SMS_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? env.AT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? getGlobalFetch();
  }

  async send(phone: string, code: string): Promise<void> {
    const minutes = Math.max(1, Math.round(env.OTP_TTL_SECONDS / 60));

    const body = new URLSearchParams({
      username: this.username,
      to: phone,
      message: renderMessage(code, minutes),
    });
    if (this.senderId) body.set('from', this.senderId);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: HttpResponseLike;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          apiKey: this.apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (error) {
      logger.error('otp.dispatch_failed', {
        provider: this.name,
        phone: maskPhone(phone),
        reason: error instanceof Error ? error.name : 'unknown',
      });
      throw new AppError('We could not send the verification code. Please try again.', 503);
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text().catch(() => '');
    const payload = parseResponse(raw);

    if (!response.ok) {
      // Meta keys must not be named `message`: that would overwrite the logger's
      // event name field and blank it out.
      logger.error('otp.dispatch_rejected', {
        provider: this.name,
        phone: maskPhone(phone),
        status: response.status,
        // Logged so a credential mismatch between username and endpoint is
        // obvious; the API key itself is never logged.
        username: this.username,
        endpoint: this.endpoint,
        errorMessage: payload.errorMessage,
        body: raw.slice(0, 500),
      });
      throw new AppError('We could not send the verification code. Please try again.', 503);
    }

    const recipients = payload.SMSMessageData?.Recipients ?? [];
    const failed = recipients.filter(
      (recipient) =>
        typeof recipient.statusCode !== 'number' ||
        !ACCEPTED_STATUS_CODES.has(recipient.statusCode)
    );

    if (recipients.length === 0 || failed.length > 0) {
      logger.error('otp.dispatch_rejected', {
        provider: this.name,
        phone: maskPhone(phone),
        status: response.status,
        atMessage: payload.SMSMessageData?.Message,
        statusCodes: recipients.map((recipient) => recipient.statusCode),
        recipientStatus: recipients.map((recipient) => recipient.status),
        body: raw.slice(0, 500),
      });
      throw new AppError('We could not send the verification code. Please try again.', 503);
    }

    // The message id is enough to trace delivery; the code itself is never logged.
    logger.info('otp.dispatch', {
      provider: this.name,
      phone: maskPhone(phone),
      messageId: recipients[0]?.messageId,
    });
  }
}
