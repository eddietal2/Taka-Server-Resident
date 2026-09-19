import { describe, expect, it } from 'vitest';

import {
  signAccessToken,
  signVerificationToken,
  verifyAccessToken,
  verifyVerificationToken,
} from '../src/lib/jwt';

const PHONE = '+255712345678';

describe('jwt', () => {
  it('round-trips a verification token to its phone number', async () => {
    const token = await signVerificationToken(PHONE);
    await expect(verifyVerificationToken(token)).resolves.toBe(PHONE);
  });

  it('round-trips an access token to its user id', async () => {
    const token = await signAccessToken('user_123');
    await expect(verifyAccessToken(token)).resolves.toBe('user_123');
  });

  it('rejects an access token where a verification token is required', async () => {
    const token = await signAccessToken('user_123');
    await expect(verifyVerificationToken(token)).resolves.toBeNull();
  });

  it('rejects a verification token where an access token is required', async () => {
    const token = await signVerificationToken(PHONE);
    await expect(verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects a garbage token', async () => {
    await expect(verifyVerificationToken('not-a-jwt')).resolves.toBeNull();
    await expect(verifyAccessToken('')).resolves.toBeNull();
  });
});
