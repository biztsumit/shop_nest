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
npm run test
```

Then open http://localhost:4100. The browser only talks to the web app: `/api/*` is forwarded
to the API (see `apps/web/next.config.ts`).

The plan, step by step, is in [ROADMAP.md](ROADMAP.md).
