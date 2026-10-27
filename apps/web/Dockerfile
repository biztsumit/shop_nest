# The storefront as a container image. Build from the REPOSITORY ROOT:
#   docker build -f apps/web/Dockerfile --build-arg API_URL=http://api:4000 -t shop-web .
#
# Next.js "standalone" output: the build traces exactly which files the server needs and
# copies them into .next/standalone, so the image doesn't carry the whole node_modules.

# ---------- build ----------
FROM node:24-slim AS build
WORKDIR /app

# Where the API is, as the WEB SERVER sees it (inside compose: the "api" service). Needed at
# BUILD time: next.config.ts bakes the /api/* rewrite destination into the build.
ARG API_URL=http://api:4000
ARG IMAGE_HOSTS
ENV API_URL=$API_URL IMAGE_HOSTS=$IMAGE_HOSTS NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --ignore-scripts

COPY . .
RUN npx turbo run build --filter=@shop/web

# ---------- run ----------
FROM node:24-slim AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=4100 HOSTNAME=0.0.0.0
WORKDIR /app

# The traced server (it keeps the monorepo layout: apps/web/server.js), plus the static files
# and the public folder, which standalone output leaves for the server to copy
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public apps/web/public

USER node
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:4100/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/web/server.js"]
