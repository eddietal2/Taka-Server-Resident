/**
 * Supplies the environment the app validates at import time. These are throwaway
 * values: the unit and contract tests never reach a real database or bucket.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/taka_test?sslmode=disable';
process.env.DIRECT_URL = 'postgresql://user:pass@localhost:5432/taka_test?sslmode=disable';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-1234';
process.env.OTP_SECRET = 'test-otp-secret-1234';
process.env.OTP_PROVIDER = 'log';
process.env.OTP_DEV_MODE = 'true';
process.env.OTP_DEV_CODE = '000000';
process.env.REGISTRATION_AUTO_APPROVE = 'true';
process.env.CORS_ORIGINS = '';
