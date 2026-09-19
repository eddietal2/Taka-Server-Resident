import { describe, expect, it } from 'vitest';

import { app } from '../src/index';
import { signVerificationToken } from '../src/lib/jwt';

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
