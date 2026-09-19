import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '../env';
import { AppError } from './http';

let client: S3Client | null = null;

function requireSetting(value: string | undefined, name: string): string {
  if (!value) {
    throw new AppError(`File storage is not configured (missing ${name}).`, 503);
  }
  return value;
}

/** Cloudflare R2 speaks the S3 API, so the AWS SDK client works unchanged. */
export function getR2Client(): S3Client {
  if (client) return client;

  const accountId = requireSetting(env.R2_ACCOUNT_ID, 'R2_ACCOUNT_ID');
  const accessKeyId = requireSetting(env.R2_ACCESS_KEY_ID, 'R2_ACCESS_KEY_ID');
  const secretAccessKey = requireSetting(env.R2_SECRET_ACCESS_KEY, 'R2_SECRET_ACCESS_KEY');

  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  return client;
}

export function presignPutObject(key: string, contentType: string): Promise<string> {
  const bucket = requireSetting(env.R2_BUCKET, 'R2_BUCKET');
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  return getSignedUrl(getR2Client(), command, { expiresIn: env.R2_PRESIGN_TTL_SECONDS });
}

export function publicUrlFor(key: string): string {
  const base = requireSetting(env.R2_PUBLIC_BASE_URL, 'R2_PUBLIC_BASE_URL').replace(/\/+$/, '');
  return `${base}/${key}`;
}
