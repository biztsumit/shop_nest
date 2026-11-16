import { z } from "zod";

// PRODUCT PHOTOS go from the admin's browser STRAIGHT to Cloudinary, never through our servers:
//   1. the web app asks the API for a signature   POST /api/admin/uploads/image-signature
//   2. it posts the file + `fields` to `uploadUrl` (Cloudinary checks the signature)
//   3. Cloudinary answers with the photo's address, which is saved like any pasted photo URL
// The signature covers `fields`: change any of them and Cloudinary refuses the upload.

// The formats Cloudinary accepts for us (it names JPEG files "jpg")
export const IMAGE_UPLOAD_FORMATS = ["jpg", "png", "webp", "avif"] as const;
export const IMAGE_UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp,image/avif";
// Cloudinary's free plan takes images up to 10 MB; checked in the browser before uploading
export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

export const imageUploadSignatureSchema = z.object({
  uploadUrl: z.url(),
  // Sent with the file as form fields, exactly as they are
  fields: z.object({
    api_key: z.string(),
    timestamp: z.string(),
    allowed_formats: z.string(),
    tags: z.string(),
    signature: z.string(),
  }),
  // Seconds since 1970; Cloudinary accepts the signature for an hour after this
  expiresAt: z.number().int(),
});

// The parts of Cloudinary's answer the web app reads
export const cloudinaryUploadSchema = z.object({
  secure_url: z.url(),
  width: z.number().int(),
  height: z.number().int(),
  bytes: z.number().int(),
  format: z.string(),
});

export type ImageUploadSignature = z.infer<typeof imageUploadSignatureSchema>;
export type CloudinaryUpload = z.infer<typeof cloudinaryUploadSchema>;
