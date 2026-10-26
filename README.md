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

**Admins.** Nobody can sign up as an admin. Make the first one on the server, after they've
signed up: `npm run make-admin -w @shop/api -- their@email.com`. Admins then manage roles with
`GET /api/admin/users` and `PATCH /api/admin/users/:id/role`. Admin routes (`@Auth('ADMIN')`)
check the role in the database on every request, so a demotion takes effect immediately, and
the shop can never lose its last admin.

### Client IPs in production

Rate limits and logs need each visitor's real IP. Requests reach the API through the Next.js
server, which **forwards** an `X-Forwarded-For` header but never **adds** one. So in production,
run the web app behind the hosting provider's load balancer (which adds the visitor's IP) and
keep `TRUST_PROXY=loopback` on the API when both run on one machine. Without a load balancer,
every visitor would look like the web server and share one rate limit.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request, on a fresh
Linux machine with a real PostgreSQL: install → typecheck → lint → unit tests → e2e tests →
build → start the built API and call it (smoke test). A red check means: don't merge yet.

The plan, step by step, is in [ROADMAP.md](ROADMAP.md).
