#!/bin/sh
set -e

if [ "${ROLE:-api}" = "api" ]; then
  echo "[entrypoint] running migrations"
  /app/ponta-api artisan migrate
fi

exec /app/ponta-api
