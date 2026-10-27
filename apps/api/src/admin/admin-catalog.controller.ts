import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  adminProductListQuerySchema,
  createCategorySchema,
  createProductSchema,
  createVariantSchema,
  updateProductSchema,
  updateVariantSchema,
  type AdminProduct,
  type AdminProductDetail,
  type AdminProductListQuery,
  type Category,
  type CreateCategory,
  type CreateProduct,
  type CreateVariant,
  type Page,
  type UpdateProduct,
  type UpdateVariant,
} from '@shop/shared';
import { z } from 'zod';
import { Auth } from '../auth/auth.decorator.js';
import { AdminCatalogService } from './admin-catalog.service.js';

const id = z.uuid();

@Auth('ADMIN')
@Controller('admin')
export class AdminCatalogController {
  constructor(private readonly catalog: AdminCatalogService) {}

  @Get('products')
  list(@Query({ schema: adminProductListQuerySchema }) query: AdminProductListQuery): Promise<Page<AdminProduct>> {
    return this.catalog.list(query);
  }

  @Post('products')
  create(@Body({ schema: createProductSchema }) body: CreateProduct): Promise<AdminProductDetail> {
    return this.catalog.create(body);
  }

  @Get('products/:id')
  get(@Param('id', { schema: id }) productId: string): Promise<AdminProductDetail> {
    return this.catalog.get(productId);
  }

  @Patch('products/:id')
  update(@Param('id', { schema: id }) productId: string, @Body({ schema: updateProductSchema }) body: UpdateProduct): Promise<AdminProductDetail> {
    return this.catalog.update(productId, body);
  }

  @Post('products/:id/variants')
  addVariant(@Param('id', { schema: id }) productId: string, @Body({ schema: createVariantSchema }) body: CreateVariant): Promise<AdminProductDetail> {
    return this.catalog.addVariant(productId, body);
  }

  @Patch('variants/:id')
  updateVariant(@Param('id', { schema: id }) variantId: string, @Body({ schema: updateVariantSchema }) body: UpdateVariant): Promise<AdminProductDetail> {
    return this.catalog.updateVariant(variantId, body);
  }

  @Delete('variants/:id')
  deleteVariant(@Param('id', { schema: id }) variantId: string): Promise<AdminProductDetail> {
    return this.catalog.deleteVariant(variantId);
  }

  @Post('categories')
  createCategory(@Body({ schema: createCategorySchema }) body: CreateCategory): Promise<Category> {
    return this.catalog.createCategory(body);
  }
}
