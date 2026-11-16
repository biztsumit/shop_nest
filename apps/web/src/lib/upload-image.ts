// Uploading product photos from the BROWSER straight to Cloudinary (never through our servers).
// The API only signs the upload: see packages/shared/src/uploads.ts for the three steps.
import {
  cloudinaryUploadSchema,
  IMAGE_UPLOAD_ACCEPT,
  imageUploadSignatureSchema,
  MAX_IMAGE_UPLOAD_BYTES,
  type CloudinaryUpload,
} from "@shop/shared";
import { api } from "./client-api";

// A problem with one file, in words an admin can act on
export class ImageUploadError extends Error {}

// Checked before anything is sent: Cloudinary would refuse these anyway, but slower and vaguer
const checkFile = (file: File): void => {
  if (!IMAGE_UPLOAD_ACCEPT.split(",").includes(file.type)) {
    throw new ImageUploadError(`${file.name}: use a JPEG, PNG, WebP or AVIF photo.`);
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new ImageUploadError(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; the most is ${MAX_IMAGE_UPLOAD_BYTES / 1024 / 1024} MB.`);
  }
};

// Uploads the files one after another (one signature covers them all: it lasts an hour) and
// returns each photo's address. Stops at the first failure: the photos before it are uploaded,
// but nothing is saved on the product until the caller saves the returned URLs.
export const uploadImages = async (files: File[], onProgress?: (done: number) => void): Promise<CloudinaryUpload[]> => {
  files.forEach(checkFile);
  const { uploadUrl, fields } = imageUploadSignatureSchema.parse(await api("/admin/uploads/image-signature", { method: "POST" }));

  const uploaded: CloudinaryUpload[] = [];
  for (const file of files) {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    form.append("file", file);
    // Plain fetch, NOT api(): this goes to Cloudinary, which must never see our access token
    const res = await fetch(uploadUrl, { method: "POST", body: form });
    const body: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = (body as { error?: { message?: string } }).error?.message;
      throw new ImageUploadError(`${file.name} couldn't be uploaded${reason ? `: ${reason}` : "."}`);
    }
    uploaded.push(cloudinaryUploadSchema.parse(body));
    onProgress?.(uploaded.length);
  }
  return uploaded;
};
