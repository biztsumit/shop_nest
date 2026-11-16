import { Controller, HttpCode, Post } from '@nestjs/common';
import type { ImageUploadSignature } from '@shop/shared';
import { Auth } from '../auth/auth.decorator.js';
import { UploadsService } from './uploads.service.js';

// Only admins may put photos into the shop's Cloudinary account
@Auth('ADMIN')
@Controller('admin/uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  // POST /api/admin/uploads/image-signature → what the browser sends to Cloudinary with the file.
  // POST, not GET: each answer is a fresh permission, which no browser or proxy should cache.
  @Post('image-signature')
  @HttpCode(200)
  imageSignature(): ImageUploadSignature {
    return this.uploads.imageSignature();
  }
}
