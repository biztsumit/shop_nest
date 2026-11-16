import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IMAGE_UPLOAD_FORMATS, type ImageUploadSignature } from '@shop/shared';
import type { Env } from '../config/env.js';
import { cloudinarySignature } from './cloudinary-signature.js';

// Cloudinary accepts a signature for an hour after its timestamp
const SIGNATURE_SECONDS = 60 * 60;
// Every product photo gets this tag: easy to find (or clean up) in the Cloudinary Media Library
const PRODUCT_TAG = 'shop-nest-product';

@Injectable()
export class UploadsService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  // Permission for ONE browser to upload photos to our Cloudinary account for the next hour.
  // Only what's in `fields` is allowed: a different format list (say, "svg", which can carry
  // scripts) or a missing tag would change the signature, and Cloudinary would refuse.
  imageSignature(now = new Date()): ImageUploadSignature {
    const cloudName = this.config.get('CLOUDINARY_CLOUD_NAME', { infer: true });
    const apiKey = this.config.get('CLOUDINARY_API_KEY', { infer: true });
    const apiSecret = this.config.get('CLOUDINARY_API_SECRET', { infer: true });
    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException("Photo upload isn't set up on this shop yet. Paste a photo URL instead.");
    }

    const timestamp = Math.floor(now.getTime() / 1000);
    const signed = { timestamp: String(timestamp), allowed_formats: IMAGE_UPLOAD_FORMATS.join(','), tags: PRODUCT_TAG };
    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      fields: { ...signed, api_key: apiKey, signature: cloudinarySignature(signed, apiSecret) },
      expiresAt: timestamp + SIGNATURE_SECONDS,
    };
  }
}
