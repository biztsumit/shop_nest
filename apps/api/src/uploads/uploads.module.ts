import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UploadsController } from './uploads.controller.js';
import { UploadsService } from './uploads.service.js';

// Product photo uploads: the API only SIGNS them; the files go straight to Cloudinary
@Module({
  imports: [AuthModule],   // for its guards
  controllers: [UploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
