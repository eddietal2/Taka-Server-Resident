import { SignJWT, jwtVerify } from 'jose';

import { env } from '../env.js';

const secret = new TextEncoder().encode(env.JWT_SECRET);

const VERIFICATION_TOKEN_TYPE = 'verify';
const ACCESS_TOKEN_TYPE = 'access';

/** Short-lived token proving a phone number was verified. Subject is the phone. */
export async function signVerificationToken(phone: string): Promise<string> {
  return new SignJWT({ typ: VERIFICATION_TOKEN_TYPE })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(phone)
    .setIssuedAt()
    .setExpirationTime(`${env.VERIFICATION_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

/** Long-lived token identifying a registered user. Subject is the user id. */
export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({ typ: ACCESS_TOKEN_TYPE })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

async function verifyTyped(token: string, expectedType: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (payload.typ !== expectedType) return null;
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

/** Returns the verified phone number, or null when invalid/expired/wrong type. */
export function verifyVerificationToken(token: string): Promise<string | null> {
  return verifyTyped(token, VERIFICATION_TOKEN_TYPE);
}

/** Returns the user id, or null when invalid/expired/wrong type. */
export function verifyAccessToken(token: string): Promise<string | null> {
  return verifyTyped(token, ACCESS_TOKEN_TYPE);
}
