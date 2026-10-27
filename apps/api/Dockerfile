# The API as a container image. Build from the REPOSITORY ROOT (it needs the shared package):
#   docker build -f apps/api/Dockerfile -t shop-api .
#
# Two stages: "build" has everything (compilers, dev tools, the Prisma CLI); the final image
# copies in only what's needed to run, starts as an unprivileged user, and holds no secrets.

# ---------- build ----------
FROM node:24-slim AS build
WORKDIR /app

# 1. The package files alone first: Docker caches this layer, so `npm ci` only runs again when
#    dependencies change, not on every code change. (--ignore-scripts: the Prisma client is
#    generated below, once the schema has been copied in.)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --ignore-scripts

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

# Production dependencies of the API workspace only (no compilers, test tools, Prisma CLI, or
# the web app's packages: about half the size of a full install)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --ignore-scripts --workspace @shop/api && npm cache clean --force

# ...plus the Prisma CLI (and dotenv, which prisma.config.ts loads), so a hosting platform can
# run `npx prisma migrate deploy` from THIS image before each release. Same versions as
# package.json, read from it: they can't drift apart.
RUN npm install --no-save --ignore-scripts --workspace @shop/api \
    "prisma@$(node -p "require('./apps/api/package.json').devDependencies.prisma")" \
    "dotenv@$(node -p "require('./apps/api/package.json').devDependencies.dotenv")" \
  && npm cache clean --force
COPY apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma/schema.prisma apps/api/prisma/
COPY apps/api/prisma/migrations apps/api/prisma/migrations

# The compiled API (its dist/ includes the generated Prisma client) and the shared package
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist

# Not root: if someone ever broke into the app, they'd have a powerless user, not the container
USER node
WORKDIR /app/apps/api
EXPOSE 4000

# Docker (and compose) ask this every 30 s; "unhealthy" containers can be restarted
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
