import { config } from 'dotenv';

// Load local secrets before anything reads process.env.
config({ path: '.env.local' });
config();

const { serve } = await import('@hono/node-server');
const { app } = await import('./index.js');
const { env } = await import('./env.js');

/**
 * Printed once at boot so a process running an older .env is obvious. `pnpm dev`
 * reads the environment only at startup and `tsx watch` does not reload on .env
 * changes, so the values below are the ones actually in use, not what is on disk.
 * The API key length is a fingerprint; the key itself is never printed.
 */
const otpSummary =
  env.OTP_PROVIDER === 'africastalking'
    ? `otp: provider=africastalking username=${env.AT_USERNAME} endpoint=${env.AT_SMS_ENDPOINT} apiKeyLength=${env.AT_API_KEY?.length ?? 0}`
    : `otp: provider=${env.OTP_PROVIDER}`;

console.log(otpSummary);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`taka-server-resident listening on http://localhost:${info.port}`);
});
