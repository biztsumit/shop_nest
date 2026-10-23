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
cd apps/api && npx prisma generate   # builds the typed database client
```

## Everyday commands (from the repository root)

```bash
npm run dev        # api + web + shared, all watching for changes
npm run build      # production builds of everything
npm run typecheck  # TypeScript, every package
npm run lint
npm run test       # unit tests (no database)
npm run test:e2e   # the real API over HTTP, against the TEST database
```

## Tests and their database

End-to-end tests run against a **separate** database, so they never touch your dev data:
create `shop_nest_test` and put its URL in `apps/api/.env.test` (see `apps/api/.env.example`).
They refuse to run against any database whose name doesn't end in `_test`, and apply the
Prisma migrations to it before starting.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request, on a fresh
Linux machine with a real PostgreSQL: install → typecheck → lint → unit tests → e2e tests →
build. A red check means: don't merge yet.

Then open http://localhost:4100. The browser only talks to the web app: `/api/*` is forwarded
to the API (see `apps/web/next.config.ts`).

The plan, step by step, is in [ROADMAP.md](ROADMAP.md).
