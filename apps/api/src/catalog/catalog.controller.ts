import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import {
  productFacetQuerySchema,
  productListQuerySchema,
  productSuggestQuerySchema,
  slugSchema,
  type Category,
  type ProductFacetQuery,
  type ProductFacets,
  type ProductDetail,
  type ProductListQuery,
  type ProductPage,
  type ProductSuggestQuery,
  type ProductSuggestions,
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
  // The whole query string is checked (and converted: "49900" → 49900) by the shared schema.
  // Typos in the search are corrected; `searchedFor` says so ("hoddie" → "hoodie").
  @Get('products')
  @Header('Cache-Control', PUBLIC_CACHE)
  listProducts(@Query({ schema: productListQuerySchema }) query: ProductListQuery): Promise<ProductPage> {
    return this.catalog.listProducts(query);
  }

  // GET /api/products/suggest?q=hoo: the search box's suggestions, as you type.
  // Declared BEFORE products/:slug, like facets.
  @Get('products/suggest')
  @Header('Cache-Control', PUBLIC_CACHE)
  suggest(@Query({ schema: productSuggestQuerySchema }) { q }: ProductSuggestQuery): Promise<ProductSuggestions> {
    return this.catalog.suggest(q);
  }

  // GET /api/products/facets?category=clothing&colour=Black: the colour and size choices.
  // Declared BEFORE products/:slug, which would otherwise take "facets" for a product's slug.
  @Get('products/facets')
  @Header('Cache-Control', PUBLIC_CACHE)
  facets(@Query({ schema: productFacetQuerySchema }) query: ProductFacetQuery): Promise<ProductFacets> {
    return this.catalog.facets(query);
  }

  // GET /api/products/classic-tee
  @Get('products/:slug')
  @Header('Cache-Control', PUBLIC_CACHE)
  getProduct(@Param('slug', { schema: slugSchema }) slug: string): Promise<ProductDetail> {
    return this.catalog.getProduct(slug);
  }
}
