import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

// The public catalog. (Admin management of products comes later, in its own module.)
@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
