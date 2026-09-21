import { describe, expect, it } from 'vitest';

import { app } from '../src/index';
import { signAccessToken, signVerificationToken } from '../src/lib/jwt';

const PHONE = '+255712345678';

const validResidentPayload = {
  phone: PHONE,
  intent: 'RESIDENT',
  first_name: 'Amina',
  last_name: 'Mwangi',
  ward_kata: 'Kata',
  street_mtaa: 'Mtaa',
  luku_meter: '12345678901',
  location: { latitude: -6.8, longitude: 39.2 },
  unit_number: '',
  profile_picture: 'https://cdn.example.com/a.jpg',
};

async function postJson(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function patchJson(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Any well-formed access-token subject; nothing here reads the account. */
const USER_ID = 'clx000000000000000000001';

describe('service routes', () => {
  it('answers the root probe', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ name: 'taka-server-resident' });
  });

  it('answers the health probe under /api/v1', async () => {
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: 'ok' });
  });

  it('returns a JSON envelope for unknown routes', async () => {
    const res = await app.request('/api/v1/nope');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ message: 'Not found.' });
  });
});

describe('otp/request validation', () => {
  it('rejects a malformed phone before touching the database', async () => {
    const res = await postJson('/api/v1/auth/otp/request', { phone: '0712345678' });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { message: string; errors?: Record<string, string> };
    expect(body.message).toBeTruthy();
    expect(body.errors?.phone).toBeTruthy();
  });
});

describe('verification gating', () => {
  it('rejects register without a token', async () => {
    const res = await postJson('/api/v1/auth/register-resident', validResidentPayload);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      message: 'Verify your phone number to continue.',
    });
  });

  it('rejects presign without a token', async () => {
    const res = await postJson('/api/v1/uploads/presign', { purpose: 'profile_picture' });
    expect(res.status).toBe(401);
  });

  it('rejects a token that is not a verification token', async () => {
    const res = await postJson('/api/v1/auth/register-resident', validResidentPayload, 'garbage');
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      message: 'Your verification has expired. Request a new code.',
    });
  });
});

describe('presign authorisation', () => {
  it('rejects a token that is neither a verification nor an access token', async () => {
    const res = await postJson(
      '/api/v1/uploads/presign',
      { purpose: 'profile_picture' },
      'garbage'
    );

    expect(res.status).toBe(401);
  });

  it('accepts an access token, so a signed-in account can replace its picture', async () => {
    const token = await signAccessToken(USER_ID);
    const res = await postJson('/api/v1/uploads/presign', { purpose: 'profile_picture' }, token);

    // tests/setup.ts deliberately leaves R2_* unset, so a 503 here is the proof
    // that the token was accepted and the request reached storage configuration
    // rather than bouncing off authentication. Before the fix this was a 401.
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      message: 'File storage is not configured (missing R2_BUCKET).',
    });
  });
});

describe('users/me', () => {
  const body = { picture_url: 'https://cdn.example.com/a.jpg' };

  it('rejects without a token', async () => {
    const res = await patchJson('/api/v1/users/me', body);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ message: 'Sign in to continue.' });
  });

  it('rejects a verification token, which is not a session', async () => {
    const token = await signVerificationToken(PHONE);
    const res = await patchJson('/api/v1/users/me', body, token);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      message: 'Your session has expired. Sign in again.',
    });
  });

  it('rejects a picture_url that is not an absolute http url', async () => {
    const token = await signAccessToken(USER_ID);
    const res = await patchJson('/api/v1/users/me', { picture_url: 'not-a-url' }, token);

    // The body is validated before the account is read, so this asserts the
    // schema without needing a database.
    expect(res.status).toBe(400);
    const errorBody = (await res.json()) as { errors?: Record<string, string> };
    expect(errorBody.errors?.picture_url).toBeTruthy();
  });

  it('rejects an empty update, which would report success and change nothing', async () => {
    const token = await signAccessToken(USER_ID);
    const res = await patchJson('/api/v1/users/me', {}, token);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      message: 'Send at least one field to update.',
    });
  });

  it('rejects a language the app does not ship', async () => {
    const token = await signAccessToken(USER_ID);
    const res = await patchJson('/api/v1/users/me', { language: 'fr' }, token);

    expect(res.status).toBe(400);
    const errorBody = (await res.json()) as { errors?: Record<string, string> };
    expect(errorBody.errors?.language).toBeTruthy();
  });

  it('rejects an appearance outside light and dark', async () => {
    const token = await signAccessToken(USER_ID);
    const res = await patchJson('/api/v1/users/me', { theme_preference: 'sepia' }, token);

    expect(res.status).toBe(400);
    const errorBody = (await res.json()) as { errors?: Record<string, string> };
    expect(errorBody.errors?.theme_preference).toBeTruthy();
  });
});

describe('register-resident', () => {
  it('returns field errors for an invalid payload', async () => {
    const token = await signVerificationToken(PHONE);
    const res = await postJson('/api/v1/auth/register-resident', {}, token);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string; errors?: Record<string, string> };
    expect(body.message).toBe('Some details need fixing.');
    expect(body.errors?.phone).toBeTruthy();
    expect(body.errors?.luku_meter).toBeTruthy();
  });

  it('rejects a payload whose phone does not match the verified number', async () => {
    const token = await signVerificationToken('+255700000000');
    const res = await postJson('/api/v1/auth/register-resident', validResidentPayload, token);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      message: 'This number does not match the number you verified.',
    });
  });
});

describe('luku/lookup', () => {
  it('rejects without a verification token', async () => {
    const res = await postJson('/api/v1/luku/lookup', {
      phone: PHONE,
      luku_meter: '12345678901',
    });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      message: 'Verify your phone number to continue.',
    });
  });

  it('rejects a malformed meter before spending an upstream lookup', async () => {
    const token = await signVerificationToken(PHONE);
    const res = await postJson(
      '/api/v1/luku/lookup',
      { phone: PHONE, luku_meter: '123' },
      token
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string; errors?: Record<string, string> };
    expect(body.message).toBe('Some details need fixing.');
    expect(body.errors?.luku_meter).toBe('LUKU meters are 11 digits.');
  });

  it('rejects a phone that does not match the verified number', async () => {
    const token = await signVerificationToken(PHONE);
    const res = await postJson(
      '/api/v1/luku/lookup',
      { phone: '+255700000000', luku_meter: '12345678901' },
      token
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      message: 'This number does not match the number you verified.',
    });
  });

  it('answers 503 when the deployment has no nTZS key', async () => {
    // tests/setup.ts deliberately leaves NTZS_API_KEY unset, so this asserts the
    // route degrades instead of reaching out with empty credentials.
    const token = await signVerificationToken(PHONE);
    const res = await postJson(
      '/api/v1/luku/lookup',
      { phone: PHONE, luku_meter: '12345678901' },
      token
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      message: 'Meter lookups are not configured on this server.',
    });
  });
});
