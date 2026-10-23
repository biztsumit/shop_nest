# Roadmap

Built one step at a time. Each step: working code, tests, and what's new explained.

## Phase 1: Foundation
- [x] 1.1 Monorepo (npm workspaces + Turborepo): NestJS API, Next.js web, shared package; Prisma connected to PostgreSQL; health check end to end
- [x] 1.2 CI on GitHub Actions: typecheck, lint, tests (with a PostgreSQL service)
- [ ] 1.3 API conventions: validation pipe using the shared zod schemas, one error format (exception filter), structured logging with request ids, security headers, rate limiting

## Phase 2: Catalog
- [ ] 2.1 Prisma models + migrations: categories, products, variants (size/colour), images
- [ ] 2.2 Public endpoints: product list with search, filters, sorting and cursor pagination; product by slug
- [ ] 2.3 Seed script with realistic demo data

## Phase 3: Accounts
- [ ] 3.1 Users: register, login, password hashing
- [ ] 3.2 Access tokens + refresh tokens in httpOnly cookies (rotation, reuse detection)
- [ ] 3.3 Guards and decorators: @CurrentUser(), @Roles('admin')
- [ ] 3.4 Email verification and password reset (queued emails)

## Phase 4: Cart and checkout
- [ ] 4.1 Cart and addresses
- [ ] 4.2 Orders in a database transaction: stock reservation, idempotency keys
- [ ] 4.3 Coupons and wishlist

## Phase 5: Payments
- [ ] 5.1 Razorpay: create payment, verify signature
- [ ] 5.2 Webhooks and reconciliation; refunds
- [ ] 5.3 Background jobs (expire unpaid orders, send emails)

## Phase 6: Storefront (Next.js)
- [ ] 6.1 Design system from day one: tokens, light/dark, UI components
- [ ] 6.2 Home, catalog with filters, product page with variant pickers
- [ ] 6.3 Cart drawer, 3-step checkout, order tracking
- [ ] 6.4 Account area, wishlist, reviews

## Phase 7: Admin
- [ ] 7.1 Products and variants, orders, coupons
- [ ] 7.2 Sales dashboard and reports

## Phase 8: Production
- [ ] 8.1 Docker images and docker-compose
- [ ] 8.2 Deployment
- [ ] 8.3 Observability: error tracking, metrics, tracing
