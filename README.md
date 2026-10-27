# shop-nest

An e-commerce app in one repository (a **monorepo**):

| Folder | What | Port |
|---|---|---|
| `apps/api` | **NestJS 12** REST API, PostgreSQL through **Prisma 7** | 4000 |
| `apps/web` | **Next.js 16** storefront (App Router, Cache Components) | 4100 |
| `packages/shared` | Types and **zod** schemas used by both apps | – |

npm **workspaces** link the three packages together, and **Turborepo** runs their scripts in
the right order (it builds `shared` before the apps that use it).

## First-time setup

Needs Node.js 24+ and a local PostgreSQL.

```bash
npm install                          # installs all three packages at once
cp apps/api/.env.example apps/api/.env   # then fill in DATABASE_URL
cp apps/web/.env.example apps/web/.env
cd apps/api && npx prisma migrate deploy   # creates the tables
cd ../.. && npm run db:seed -w @shop/api      # demo shop: 8 categories, 23 products
```

The seed can be run again at any time: it updates the demo products instead of duplicating
them, leaves your own products alone, and refuses to run in production.

## Everyday commands (from the repository root)

```bash
npm run dev        # api + web + shared, all watching for changes
npm run build      # production builds of everything
npm run typecheck  # TypeScript, every package
npm run lint
npm run test       # unit tests (no database)
npm run test:e2e   # the real API over HTTP, against the TEST database
```

Then open http://localhost:4100. The browser only talks to the web app: `/api/*` is forwarded
to the API (see `apps/web/next.config.ts`).

## Changing the database

1. Edit `apps/api/prisma/schema.prisma`
2. `npm run db:migrate -w @shop/api -- --name what-changed`: writes a new SQL migration in
   `prisma/migrations/`, applies it to your dev database, and regenerates the typed client
3. Commit the migration together with the schema. CI and every other machine apply it with
   `prisma migrate deploy`; never edit a migration that's already committed

Rules Prisma's schema can't express (stock ≥ 0, slug format...) are CHECK constraints written
by hand at the end of a migration: create it with `--create-only`, add the SQL, then run
`db:migrate` again to apply it.

## Tests and their database

End-to-end tests run against a **separate** database, so they never touch your dev data:
create `shop_nest_test` and put its URL in `apps/api/.env.test` (see `apps/api/.env.example`).
They refuse to run against any database whose name doesn't end in `_test`, and apply the
Prisma migrations to it before starting.

## API conventions

Every endpoint follows the same rules (set up in `apps/api/src/setup-app.ts`):

- **Errors** always come back as [Problem Details](https://www.rfc-editor.org/rfc/rfc9457)
  (`application/problem+json`, shape in `packages/shared/src/problem.ts`), with one entry per
  invalid field for validation errors (status 422).
- **Validation**: declare a schema on the parameter, `@Body({ schema: someSchema })`, using
  the zod schemas from `@shop/shared`, so the web app and the API check input the same way.
- **Request ids**: every response has an `X-Request-Id`, the same id as in its log line.
- **Logs**: one JSON line per request (pino), colourful in development.
- **Security headers** (Helmet) and **rate limiting** per IP address (`RATE_LIMIT_PER_MINUTE`).

### Accounts and sessions

| | |
|---|---|
| `POST /api/auth/register`, `POST /api/auth/login` | the user + a 15-minute **access token**, and a **refresh token** in an httpOnly cookie |
| `GET /api/auth/me` | needs `Authorization: Bearer <access token>` |
| `POST /api/auth/refresh` | the cookie → a new access token and a new cookie (each refresh token works once) |
| `POST /api/auth/logout`, `POST /api/auth/logout-all` | end this login, or every login of the user |

The web app keeps the access token in memory only, and calls `refresh` when it expires or the
page reloads. A refresh token used twice (a copy) ends that whole login.

**Emails and passwords.**

| | |
|---|---|
| `POST /api/auth/verify-email` | `{ token }` from the link emailed at sign-up |
| `POST /api/auth/resend-verification` | a new link (logged in); older links stop working |
| `POST /api/auth/forgot-password` | `{ email }`: always 202, so it never reveals who has an account |
| `POST /api/auth/reset-password` | `{ token, password }`: logs out every device |
| `POST /api/auth/change-password` | `{ currentPassword, newPassword }` (logged in): other devices are logged out |

Link tokens are single-use and expire (verification 24 h, reset 1 h); only their hashes are
stored. Emails are **queued** (pg-boss, in the `pgboss` schema of the same database) and sent by
a background worker with retries. `EMAIL_TRANSPORT` decides how they go out:

- `log` (default): written to `apps/api/.emails/`; open the `.html` files in a browser
- `brevo`: really sent through Brevo (needs `BREVO_API_KEY`). While testing, set
  `EMAIL_REDIRECT_TO=you@example.com` so every email goes to your own inbox
- `memory`: kept in memory. The e2e tests always use this, whatever `.env.test` says

**Admins.** Nobody can sign up as an admin. Make the first one on the server, after they've
signed up: `npm run make-admin -w @shop/api -- their@email.com`. Admins then manage roles with
`GET /api/admin/users` and `PATCH /api/admin/users/:id/role`. Admin routes (`@Auth('ADMIN')`)
check the role in the database on every request, so a demotion takes effect immediately, and
the shop can never lose its last admin.

### Cart and addresses

Both need a login. The cart lives on the server (`/api/cart`); before logging in, the web app
keeps one in the browser and sends it to `POST /api/cart/merge` afterwards.

| | |
|---|---|
| `GET /api/cart` | lines with **today's** price and stock; a `problem` per line if it can't be bought as is |
| `POST /api/cart/items` | `{ variantId, quantity }`: adds to what's there (max 10 of one item, 50 lines) |
| `PUT /api/cart/items/:variantId` | `{ quantity }`: sets it; 0 removes |
| `DELETE /api/cart/items/:variantId`, `DELETE /api/cart` | remove one line, or everything |
| `GET/POST /api/addresses`, `GET/PATCH/DELETE /api/addresses/:id` | up to 10 Indian addresses, one default |

### Orders

| | |
|---|---|
| `POST /api/orders/quote` | `{ couponCode? }`: subtotal, discount, delivery (free from ₹999, else ₹49), total |
| `POST /api/orders` | `{ addressId, couponCode?, expectedTotal? }` + an **`Idempotency-Key`** header |
| `GET /api/orders`, `GET /api/orders/:number` | my orders (`SN000123`) |
| `POST /api/orders/:number/cancel` | only before paying |

Placing an order is one database transaction: it takes the stock with conditional updates
(`stock >= quantity`), copies names, prices and the address into the order, and empties those
cart lines. Any problem rolls all of it back. Sending the same `Idempotency-Key` again returns
the same order (`200`, `Idempotent-Replayed: true`) instead of placing a second one; a new
checkout needs a new key. Unpaid orders expire after `ORDER_PAYMENT_MINUTES` (30), and their
stock goes back on sale.

**Coupons** (`couponCode` in the quote and the order): percentage (capped) or fixed amount,
optional minimum, dates, total and per-shopper limits. A coupon that can't be used comes back
as a 422 on the `couponCode` field with the reason. Redeeming locks the coupon row, so its
usage limit can't be overrun by orders placed at the same moment. Cancelled and expired
orders give their coupon use back. The seed adds `WELCOME10`, `FLAT200` and `FESTIVE15`.

### Payments (Razorpay)

1. `POST /api/orders/:number/payment` creates (once) a Razorpay order and returns what
   Razorpay Checkout needs (`keyId`, `razorpayOrderId`, `amount`, prefill).
2. The browser opens Checkout; on success Checkout hands it `razorpay_payment_id` and a
   **signature** (HMAC-SHA256 of `order_id|payment_id` with our secret, which the browser can't fake).
3. `POST /api/orders/:number/payment/verify` checks the signature, then asks Razorpay for the
   payment itself (captured? right amount?) before marking the order `PAID` and emailing a
   confirmation. Sending the same receipt twice is harmless.

A payment that arrives after its order expired takes the stock again if it's still there;
otherwise it's refunded automatically. Without `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`, payment
endpoints answer 503. The e2e tests use a **fake Razorpay server** (`test/support/fake-razorpay.ts`,
port 4999), never the real one.

**Webhook.** In the Razorpay Dashboard (Settings → Webhooks), add
`https://<your API host>/api/webhooks/razorpay` with the events `payment.captured`,
`payment.failed`, `order.paid`, `refund.processed` and `refund.failed`, and put its secret in
`RAZORPAY_WEBHOOK_SECRET`. The signature is checked over the raw request body; each event id is
processed once. This records payments even when the shopper closes the tab before the browser
reports back. As a last safety net, a reconciliation job asks Razorpay about payments still
unsettled after 2 minutes.

### Admin back office (`/admin`)

Admins (see "Admins" above) get an **Admin** link in the account menu: a sales dashboard,
orders (ship, deliver, cancel, refund), products and variants, coupons and review moderation.
The dashboard reads `GET /api/admin/reports/sales?days=7|30|90` (India-time days, compared with
the period before) and exports `GET /api/admin/reports/orders.csv`. CSV cells that look like
spreadsheet formulas (`=`, `+`, `-`, `@`) are made plain text, so a customer's name can't run in
someone's Excel.

For a dashboard with history while developing: `npm run db:seed-sales -w @shop/api` adds about
75 days of demo orders (opt-in, idempotent, refuses production).

**Time zones.** The database connection always uses `TimeZone=UTC` (`src/prisma/adapter.ts`):
Prisma sends dates without an offset, so on a PostgreSQL server set to India time they were
stored 5½ hours early. Reports group by India-time days in SQL (`AT TIME ZONE 'Asia/Kolkata'`).

### Background jobs

pg-boss keeps jobs in the `pgboss` schema of the same database (no Redis). Besides queued
emails, three jobs run on a timetable (India time; with several servers, each run happens once):

| Job | When | What |
|---|---|---|
| `orders.expire` | every minute | unpaid orders past `ORDER_PAYMENT_MINUTES` expire; stock and coupon uses go back |
| `payments.reconcile` | every 5 minutes | asks Razorpay about payments nobody reported (if keys are set) |
| `maintenance.clean-up` | 03:30 nightly | deletes expired tokens and old webhook records |

`JOBS_ENABLED=false` stops this process from running jobs (useful with several servers);
`JOB_SCHEDULES_ENABLED=false` stops the timetable. The e2e tests turn the timetable off and call
the same functions directly.

**Refunds** (admins): `GET/POST /api/admin/orders/:number/refunds` with `{ amount?, reason,
restock? }`. Leaving out `amount` refunds everything not yet refunded. The amount is reserved in
the database (under a row lock) before Razorpay is asked, and released if Razorpay refuses, so
two clicks can never refund twice.

**Wishlist**: `GET /api/wishlist`, `GET /api/wishlist/ids`, `PUT/DELETE /api/wishlist/:productId`.

**Reviews**: `GET /api/products/:slug/reviews` (public), and `GET/PUT/DELETE
/api/products/:slug/reviews/mine` (one per shopper, editable). "Verified purchase" means a paid
order with the product. The product page includes `rating: { average, count, distribution }`.

### Client IPs in production

Rate limits and logs need each visitor's real IP. Requests reach the API through the Next.js
server, which **forwards** an `X-Forwarded-For` header but never **adds** one. So in production,
run the web app behind the hosting provider's load balancer (which adds the visitor's IP) and
keep `TRUST_PROXY=loopback` on the API when both run on one machine. Without a load balancer,
every visitor would look like the web server and share one rate limit.

## Observability

- **Logs**: one JSON line per request (pino), with a request id that is also sent back as
  `X-Request-Id` and in every error response, so a customer's "it failed" can be found.
- **Metrics**: `GET /api/metrics` (Prometheus format), only with `Authorization: Bearer
  $METRICS_TOKEN` (no token configured = no endpoint). Requests and their durations by **route
  pattern** (`/api/products/:slug`, never the raw URL), Node's own health, and business
  counters: `shop_orders_placed_total`, `shop_payments_captured_total`, `shop_emails_total{result}`.
- **Errors and tracing**: Sentry, on when `SENTRY_DSN` is set. `src/instrument.ts` is loaded
  with `node --import ./dist/instrument.js` (Docker and `start:prod` do this) so it can trace
  HTTP, Express and PostgreSQL calls; 5xx errors are reported with their request id. Personal
  data is switched off explicitly: this Sentry SDK version collects request bodies, headers
  and cookies **by default**.

## Docker

```bash
cp .env.example .env                                   # set POSTGRES_PASSWORD and JWT_SECRET
docker compose up --build                              # → http://localhost:4100 (API on :4000)
docker compose run --rm migrate npm run db:seed        # optional: the demo catalog
```

`docker-compose.yml` starts PostgreSQL, runs the migrations once, then the API, then the
storefront, each waiting for the one before. The images (`apps/api/Dockerfile`,
`apps/web/Dockerfile`) are built from the repository root in two stages: a build stage with all
tools, and a small run stage (production dependencies only / Next.js standalone output) that
runs as an unprivileged user and contains no secrets (`.dockerignore` keeps every `.env` out).
Settings come from the environment at run time. The web image needs `API_URL` at **build**
time too, because Next.js writes the `/api/*` rewrite into the build.

**Going live:** [`render.yaml`](render.yaml) describes a free-tier setup on Render with the
database on Neon (node-learning keeps its own database). It isn't deployed yet; the
steps are in [docs/DEPLOY.md](docs/DEPLOY.md).

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request, on a fresh
Linux machine with a real PostgreSQL: install → typecheck → lint → unit tests → e2e tests →
build → start the built API and call it (smoke test). A second job builds the Docker images,
starts the compose stack, seeds it and reads a product through the storefront. A red check
means: don't merge yet.

The plan, step by step, is in [ROADMAP.md](ROADMAP.md).
