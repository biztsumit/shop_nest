# Roadmap

Built one step at a time. Each step: working code, tests, and what's new explained.

## Phase 1: Foundation
- [x] 1.1 Monorepo (npm workspaces + Turborepo): NestJS API, Next.js web, shared package; Prisma connected to PostgreSQL; health check end to end
- [x] 1.2 CI on GitHub Actions: typecheck, lint, tests (with a PostgreSQL service)
- [x] 1.3 API conventions: validation pipe using the shared zod schemas, one error format (exception filter), structured logging with request ids, security headers, rate limiting

## Phase 2: Catalog
- [x] 2.1 Prisma models + migrations: categories, products, variants (size/colour), images
- [x] 2.2 Public endpoints: product list with search, filters, sorting and cursor pagination; product by slug
- [x] 2.3 Seed script with realistic demo data

## Phase 3: Accounts
- [x] 3.1 Users: register, login, Argon2id password hashing, short-lived access token, AccessTokenGuard + @CurrentUser()
- [x] 3.2 Refresh tokens in httpOnly cookies (rotation, reuse detection, Origin check), logout and log out everywhere
- [x] 3.3 Roles: @Auth('ADMIN') (role checked in the database), make-admin script, admin user list and role changes (never zero admins)
- [x] 3.4 Email verification and password reset (queued emails)

## Phase 4: Cart and checkout
- [x] 4.1 Cart and addresses
- [x] 4.2 Orders in a database transaction: stock reservation, idempotency keys
- [x] 4.3 Coupons, wishlist and reviews

## Phase 5: Payments
- [x] 5.1 Razorpay: create payment, verify signature
- [x] 5.2 Webhooks and reconciliation; refunds
- [x] 5.3 Background jobs (expire unpaid orders, send emails)

## Phase 6: Storefront (Next.js)
- [x] 6.1 Design system from day one: tokens, light/dark, UI components
- [ ] 6.2 Home, catalog with filters, product page with variant pickers
- [ ] 6.3 Cart drawer, 3-step checkout, order tracking
- [ ] 6.4 Account area, wishlist, reviews

## Phase 7: Admin
- [ ] 7.1 Products and variants, orders, coupons
- [ ] 7.2 Sales dashboard and reports

## Phase 8: Production
- [ ] 8.1 Docker images and docker-compose
- [ ] 8.2 Deployment (behind the host's load balancer, which must add X-Forwarded-For: see README "Client IPs")
- [ ] 8.3 Observability: error tracking, metrics, tracing
