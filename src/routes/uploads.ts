import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';

import { ok } from '../lib/http';
import { presignPutObject, publicUrlFor } from '../lib/r2';
import { readValidatedJson } from '../lib/validate';
import { requireVerificationToken } from '../middleware/auth';
import { extensionForContentType, presignRequestSchema } from '../schemas/uploads';
import type { AppEnv } from '../types';

export const uploadRoutes = new Hono<AppEnv>();

uploadRoutes.post('/uploads/presign', requireVerificationToken, async (c) => {
  const phone = c.get('verificationPhone');
  const { purpose, content_type } = await readValidatedJson(c, presignRequestSchema);

  const phoneSegment = phone.replace(/\D/g, '');
  const key = `${purpose}/${phoneSegment}/${randomUUID()}.${extensionForContentType(content_type)}`;

  const uploadUrl = await presignPutObject(key, content_type);

  return ok(c, { uploadUrl, publicUrl: publicUrlFor(key), key });
});
