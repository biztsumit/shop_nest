import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import {
  productListQuerySchema,
  slugSchema,
  type Category,
  type Page,
  type ProductDetail,
  type ProductListQuery,
  type ProductSummary,
} from '@shop/shared';
import { CatalogService } from './catalog.service.js';

// Public and the same for everyone, so browsers and CDNs may keep a copy for a minute, and
// serve the old copy for up to 5 more while fetching a fresh one in the background
const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // GET /api/categories
  @Get('categories')
  @Header('Cache-Control', PUBLIC_CACHE)
  listCategories(): Promise<Category[]> {
    return this.catalog.listCategories();
  }

  // GET /api/products?search=tee&category=clothing&minPrice=50000&sort=price_asc&cursor=...
  // The whole query string is checked (and converted: "49900" → 49900) by the shared schema
  @Get('products')
  @Header('Cache-Control', PUBLIC_CACHE)
  listProducts(@Query({ schema: productListQuerySchema }) query: ProductListQuery): Promise<Page<ProductSummary>> {
    return this.catalog.listProducts(query);
  }

  // GET /api/products/classic-tee
  @Get('products/:slug')
  @Header('Cache-Control', PUBLIC_CACHE)
  getProduct(@Param('slug', { schema: slugSchema }) slug: string): Promise<ProductDetail> {
    return this.catalog.getProduct(slug);
  }
}
