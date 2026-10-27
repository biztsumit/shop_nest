#!/bin/sh
# How the API container starts (apps/api/Dockerfile runs this).
#
# MIGRATE_ON_START=true: apply new database migrations first. For hosts without a separate
# "before deploy" step (Render's free plan). Safe with ONE instance: `migrate deploy` only
# applies what's missing. Not set: just start (docker-compose runs migrations as its own step).
set -e

if [ "$MIGRATE_ON_START" = "true" ]; then
  # Up to 5 tries, 5 s apart: a free database that was asleep (Neon scales to zero) can take
  # a few seconds to wake up, and the first try may give up before it's ready
  attempt=1
  until echo "Applying database migrations (try $attempt of 5)..." && npx prisma migrate deploy; do
    if [ "$attempt" -ge 5 ]; then
      echo "Migrations failed 5 times: not starting the API." >&2
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep 5
  done
fi

# exec: node REPLACES this shell, so the stop signal from Docker/Render reaches the app
# directly and it can shut down gracefully (finish requests, stop the job queue)
exec node --import ./dist/instrument.js dist/main.js
