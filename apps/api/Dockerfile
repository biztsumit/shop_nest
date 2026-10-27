# The API as a container image. Build from the REPOSITORY ROOT (it needs the shared package):
#   docker build -f apps/api/Dockerfile -t shop-api .
#
# Two stages: "build" has everything (compilers, dev tools, the Prisma CLI); the final image
# copies in only what's needed to run, starts as an unprivileged user, and holds no secrets.

# ---------- build ----------
FROM node:24-slim AS build
WORKDIR /app

# OpenSSL: Prisma's migration engine needs it (the "slim" image leaves it out)
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# 1. The package files alone first: Docker caches this layer, so `npm ci` only runs again when
#    dependencies change, not on every code change. (--ignore-scripts: the Prisma client is
#    generated below, once the schema has been copied in.) But Prisma's OWN install step must
#    run (npm rebuild): it downloads the migration engine, a native program. Skipped, the CLI
#    tries to download it at run time instead, and fails.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --ignore-scripts && npm rebuild prisma @prisma/engines

# 2. The code, then build the shared package and the API (Turborepo builds them in order)
COPY . .
RUN cd apps/api && npx prisma generate
RUN npx turbo run build --filter=@shop/api

# The "migrate" service in docker-compose.yml uses THIS stage: it has the Prisma CLI
WORKDIR /app/apps/api

# ---------- run ----------
FROM node:24-slim AS run
ENV NODE_ENV=production
WORKDIR /app

# OpenSSL for Prisma's migration engine (see the build stage)
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Production dependencies of the API workspace only (no compilers, test tools, Prisma CLI, or
# the web app's packages: about half the size of a full install)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --ignore-scripts --workspace @shop/api && npm cache clean --force

# ...plus the Prisma CLI (and dotenv, which prisma.config.ts loads), so the API can run
# `npx prisma migrate deploy` from THIS image (MIGRATE_ON_START). Same versions as
# package.json, read from it: they can't drift apart. Then Prisma's own install step, to
# download the migration engine NOW, as root: the app later runs as `node`, which can't write
# into node_modules (so a download at run time would fail).
RUN npm install --no-save --ignore-scripts --workspace @shop/api \
    "prisma@$(node -p "require('./apps/api/package.json').devDependencies.prisma")" \
    "dotenv@$(node -p "require('./apps/api/package.json').devDependencies.dotenv")" \
  && npm rebuild prisma @prisma/engines \
  && npm cache clean --force
COPY apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma/schema.prisma apps/api/prisma/
COPY apps/api/prisma/migrations apps/api/prisma/migrations

# The compiled API (its dist/ includes the generated Prisma client) and the shared package
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY apps/api/scripts/start.sh apps/api/scripts/start.sh

# Not root: if someone ever broke into the app, they'd have a powerless user, not the container
USER node
WORKDIR /app/apps/api
EXPOSE 4000

# Docker (and compose) ask this every 30 s; "unhealthy" containers can be restarted
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# scripts/start.sh: migrations first if MIGRATE_ON_START=true, then the API (with --import,
# which loads error tracking/tracing first; it does nothing without SENTRY_DSN)
CMD ["sh", "scripts/start.sh"]
