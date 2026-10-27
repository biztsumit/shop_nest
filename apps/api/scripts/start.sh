#!/bin/sh
# How the API container starts (apps/api/Dockerfile runs this).
#
# MIGRATE_ON_START=true: apply new database migrations first. For hosts without a separate
# "before deploy" step (Render's free plan). Safe with ONE instance: `migrate deploy` only
# applies what's missing. Not set: just start (docker-compose runs migrations as its own step).
set -e

if [ "$MIGRATE_ON_START" = "true" ]; then
  echo "Applying database migrations..."
  npx prisma migrate deploy
fi

# exec: node REPLACES this shell, so the stop signal from Docker/Render reaches the app
# directly and it can shut down gracefully (finish requests, stop the job queue)
exec node --import ./dist/instrument.js dist/main.js
