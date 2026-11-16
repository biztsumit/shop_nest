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
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AdminCatalogService } from './admin-catalog.service.js';

const id = z.uuid();

// Every change passes the admin along: it's recorded in the audit log
@Auth('ADMIN')
@Controller('admin')
export class AdminCatalogController {
  constructor(private readonly catalog: AdminCatalogService) {}

  @Get('products')
  list(@Query({ schema: adminProductListQuerySchema }) query: AdminProductListQuery): Promise<Page<AdminProduct>> {
    return this.catalog.list(query);
  }

  @Post('products')
  create(@CurrentUser() admin: AuthUser, @Body({ schema: createProductSchema }) body: CreateProduct): Promise<AdminProductDetail> {
    return this.catalog.create(body, admin.id);
  }

  @Get('products/:id')
  get(@Param('id', { schema: id }) productId: string): Promise<AdminProductDetail> {
    return this.catalog.get(productId);
  }

  @Patch('products/:id')
  update(
    @CurrentUser() admin: AuthUser,
    @Param('id', { schema: id }) productId: string,
    @Body({ schema: updateProductSchema }) body: UpdateProduct,
  ): Promise<AdminProductDetail> {
    return this.catalog.update(productId, body, admin.id);
  }

  @Post('products/:id/variants')
  addVariant(
    @CurrentUser() admin: AuthUser,
    @Param('id', { schema: id }) productId: string,
    @Body({ schema: createVariantSchema }) body: CreateVariant,
  ): Promise<AdminProductDetail> {
    return this.catalog.addVariant(productId, body, admin.id);
  }

  @Patch('variants/:id')
  updateVariant(
    @CurrentUser() admin: AuthUser,
    @Param('id', { schema: id }) variantId: string,
    @Body({ schema: updateVariantSchema }) body: UpdateVariant,
  ): Promise<AdminProductDetail> {
    return this.catalog.updateVariant(variantId, body, admin.id);
  }

  @Delete('variants/:id')
  deleteVariant(@CurrentUser() admin: AuthUser, @Param('id', { schema: id }) variantId: string): Promise<AdminProductDetail> {
    return this.catalog.deleteVariant(variantId, admin.id);
  }

  @Post('categories')
  createCategory(@CurrentUser() admin: AuthUser, @Body({ schema: createCategorySchema }) body: CreateCategory): Promise<Category> {
    return this.catalog.createCategory(body, admin.id);
  }
}
