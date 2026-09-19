import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';

import { ok } from '../lib/http.js';
import { presignPutObject, publicUrlFor } from '../lib/r2.js';
import { readValidatedJson } from '../lib/validate.js';
import { requireVerificationToken } from '../middleware/auth.js';
import { extensionForContentType, presignRequestSchema } from '../schemas/uploads.js';
import type { AppEnv } from '../types.js';

export const uploadRoutes = new Hono<AppEnv>();

uploadRoutes.post('/uploads/presign', requireVerificationToken, async (c) => {
  const phone = c.get('verificationPhone');
  const { purpose, content_type } = await readValidatedJson(c, presignRequestSchema);

  const phoneSegment = phone.replace(/\D/g, '');
  const key = `${purpose}/${phoneSegment}/${randomUUID()}.${extensionForContentType(content_type)}`;

  const uploadUrl = await presignPutObject(key, content_type);

  return ok(c, { uploadUrl, publicUrl: publicUrlFor(key), key });
});
