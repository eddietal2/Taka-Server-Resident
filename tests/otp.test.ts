import { describe, expect, it } from 'vitest';

import {
  generateOtpCode,
  hashOtpCode,
  isDevBypassCode,
  otpCodeMatches,
} from '../src/lib/otp';

const PHONE = '+255712345678';

describe('otp', () => {
  it('generates a six digit code', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it('hashes deterministically for the same phone and code', () => {
    expect(hashOtpCode(PHONE, '123456')).toBe(hashOtpCode(PHONE, '123456'));
  });

  it('binds the hash to the phone number', () => {
    expect(hashOtpCode(PHONE, '123456')).not.toBe(hashOtpCode('+255700000000', '123456'));
  });

  it('binds the hash to the code', () => {
    expect(hashOtpCode(PHONE, '123456')).not.toBe(hashOtpCode(PHONE, '654321'));
  });

  it('matches only identical hashes', () => {
    const stored = hashOtpCode(PHONE, '123456');
    expect(otpCodeMatches(stored, hashOtpCode(PHONE, '123456'))).toBe(true);
    expect(otpCodeMatches(stored, hashOtpCode(PHONE, '000001'))).toBe(false);
  });

  it('rejects malformed stored hashes instead of throwing', () => {
    expect(otpCodeMatches('', hashOtpCode(PHONE, '123456'))).toBe(false);
    expect(otpCodeMatches('zzzz', hashOtpCode(PHONE, '123456'))).toBe(false);
  });

  it('accepts the fixed dev code while OTP_DEV_MODE is on', () => {
    expect(isDevBypassCode('000000')).toBe(true);
    expect(isDevBypassCode('111111')).toBe(false);
  });
});
