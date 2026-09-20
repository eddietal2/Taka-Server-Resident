import { describe, expect, it } from 'vitest';

import {
  commercialPayloadSchema,
  registerPayloadSchema,
  reporterPayloadSchema,
  residentPayloadSchema,
} from '../src/schemas/auth';
import { otpRequestSchema, otpVerifySchema } from '../src/schemas/phone';
import { presignRequestSchema } from '../src/schemas/uploads';

const residentPayload = {
  phone: '+255712345678',
  intent: 'RESIDENT' as const,
  first_name: 'Amina',
  last_name: 'Mwangi',
  ward_kata: 'Kata',
  street_mtaa: 'Mtaa',
  luku_meter: '12345678901',
  location: { latitude: -6.8, longitude: 39.2 },
  unit_number: '',
  profile_picture: 'https://cdn.example.com/a.jpg',
};

const commercialPayload = {
  phone: '+255712345678',
  intent: 'COMMERCIAL' as const,
  business_name: 'Taka Ltd',
  ward_kata: 'Kata',
  street_mtaa: 'Mtaa',
  location: { latitude: -6.8, longitude: 39.2 },
  waste_tier: 'HIGH_VOLUME_DAILY' as const,
  tax_id: '123-456-789',
  business_logo: 'https://cdn.example.com/logo.jpg',
};

describe('phone schemas', () => {
  it('accepts E.164 Tanzanian numbers', () => {
    expect(otpRequestSchema.safeParse({ phone: '+255712345678' }).success).toBe(true);
  });

  it('rejects local-format numbers the app already normalises', () => {
    expect(otpRequestSchema.safeParse({ phone: '0712345678' }).success).toBe(false);
    expect(otpRequestSchema.safeParse({ phone: '+25571234567' }).success).toBe(false);
  });

  it('requires a six digit verification code', () => {
    expect(otpVerifySchema.safeParse({ phone: '+255712345678', code: '123456' }).success).toBe(true);
    expect(otpVerifySchema.safeParse({ phone: '+255712345678', code: '12345' }).success).toBe(false);
    expect(otpVerifySchema.safeParse({ phone: '+255712345678', code: 'abcdef' }).success).toBe(false);
  });
});

describe('residentPayloadSchema', () => {
  it('accepts the shape the app builds', () => {
    expect(residentPayloadSchema.safeParse(residentPayload).success).toBe(true);
  });

  it('rejects a LUKU meter that is not 11 digits', () => {
    const result = residentPayloadSchema.safeParse({ ...residentPayload, luku_meter: '123' });
    expect(result.success).toBe(false);
  });

  it('rejects an out-of-range latitude', () => {
    const result = residentPayloadSchema.safeParse({
      ...residentPayload,
      location: { latitude: 120, longitude: 39.2 },
    });
    expect(result.success).toBe(false);
  });

  it('accepts an empty unit number', () => {
    expect(residentPayloadSchema.safeParse({ ...residentPayload, unit_number: '' }).success).toBe(
      true
    );
  });

  it('accepts an empty street now that it is optional', () => {
    expect(residentPayloadSchema.safeParse({ ...residentPayload, street_mtaa: '' }).success).toBe(
      true
    );
  });
});

describe('reporter and commercial schemas', () => {
  it('accepts a minimal reporter payload', () => {
    expect(
      reporterPayloadSchema.safeParse({
        phone: '+255712345678',
        intent: 'REPORTER',
        first_name: 'Juma',
        last_name: 'Ali',
        profile_picture: 'https://cdn.example.com/a.jpg',
      }).success
    ).toBe(true);
  });

  it('accepts an empty street for commercial', () => {
    expect(
      commercialPayloadSchema.safeParse({ ...commercialPayload, street_mtaa: '' }).success
    ).toBe(true);
  });

  it('validates the TIN format for commercial', () => {
    expect(commercialPayloadSchema.safeParse(commercialPayload).success).toBe(true);
    expect(
      commercialPayloadSchema.safeParse({ ...commercialPayload, tax_id: '123456789' }).success
    ).toBe(false);
  });

  it('rejects an unknown waste tier', () => {
    expect(
      commercialPayloadSchema.safeParse({ ...commercialPayload, waste_tier: 'LOW' }).success
    ).toBe(false);
  });
});

describe('registerPayloadSchema', () => {
  it('discriminates on intent', () => {
    expect(registerPayloadSchema.safeParse(residentPayload).success).toBe(true);
    expect(registerPayloadSchema.safeParse(commercialPayload).success).toBe(true);
    expect(
      registerPayloadSchema.safeParse({ ...residentPayload, intent: 'UNKNOWN' }).success
    ).toBe(false);
  });
});

describe('presignRequestSchema', () => {
  it('accepts a supported purpose and content type', () => {
    expect(
      presignRequestSchema.safeParse({ purpose: 'profile_picture', content_type: 'image/jpeg' })
        .success
    ).toBe(true);
  });

  it('defaults the content type to jpeg', () => {
    const result = presignRequestSchema.safeParse({ purpose: 'business_logo' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.content_type).toBe('image/jpeg');
  });

  it('rejects an unsupported purpose', () => {
    expect(presignRequestSchema.safeParse({ purpose: 'selfie' }).success).toBe(false);
  });
});
