import { z } from 'zod';

export const UPLOAD_PURPOSES = ['profile_picture', 'business_logo'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const ALLOWED_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;
export type AllowedImageContentType = (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];

export const presignRequestSchema = z.object({
  purpose: z.enum(UPLOAD_PURPOSES),
  content_type: z.enum(ALLOWED_IMAGE_CONTENT_TYPES).default('image/jpeg'),
});

export function extensionForContentType(contentType: string): string {
  return contentType === 'image/png' ? 'png' : 'jpg';
}
