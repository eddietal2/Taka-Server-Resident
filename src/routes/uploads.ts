import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';

import { ok } from '../lib/http.js';
import { presignPutObject, publicUrlFor } from '../lib/r2.js';
import { readValidatedJson } from '../lib/validate.js';
import { requireUploadAuth } from '../middleware/auth.js';
import { extensionForContentType, presignRequestSchema } from '../schemas/uploads.js';
import type { AppEnv, UploadOwner } from '../types.js';

export const uploadRoutes = new Hono<AppEnv>();

/**
 * Namespaces an object by its owner.
 *
 * A verified phone keeps the bare digits it already produced, so keys and public
 * URLs minted by earlier sign-ups are untouched. A signed-in upload nests under
 * `users/` instead, which also keeps the two namespaces from ever colliding —
 * a user id and a phone number are both opaque strings to R2.
 */
function ownerSegment(owner: UploadOwner): string {
  return owner.kind === 'user' ? `users/${owner.userId}` : owner.phone.replace(/\D/g, '');
}

uploadRoutes.post('/uploads/presign', requireUploadAuth, async (c) => {
  const owner = c.get('uploadOwner');
  const { purpose, content_type } = await readValidatedJson(c, presignRequestSchema);

  const key = `${purpose}/${ownerSegment(owner)}/${randomUUID()}.${extensionForContentType(content_type)}`;

  const uploadUrl = await presignPutObject(key, content_type);

  return ok(c, { uploadUrl, publicUrl: publicUrlFor(key), key });
});
