#!/bin/sh
set -e

# Apply default environment configurations for all-in-one container
export ROLE=${ROLE:-api}
export APP_HOST=${APP_HOST:-127.0.0.1}
export APP_PORT=${APP_PORT:-3000}
export DB_CONNECTION=${DB_CONNECTION:-sqlite}
export DB_DATABASE=${DB_DATABASE:-/app/storage/database.sqlite}
export QUEUE_CONNECTION=${QUEUE_CONNECTION:-sync}

echo "[entrypoint] initializing Ponta Drive all-in-one container..."

# Ensure storage directories exist with appropriate permissions
mkdir -p /app/storage/app /app/storage/framework /app/storage/logs
if [ -n "$DB_DATABASE" ]; then
  db_dir=$(dirname "$DB_DATABASE")
  mkdir -p "$db_dir"
fi

# Run database migrations before starting public listeners
if [ "$ROLE" = "api" ]; then
  echo "[entrypoint] running database migrations ($DB_CONNECTION)..."
  /app/ponta-api artisan migrate
fi

# Setup process tracking and graceful shutdown traps
API_PID=""
NGINX_PID=""

cleanup() {
  EXIT_CODE=${1:-0}
  echo "[entrypoint] received termination signal, shutting down gracefully..."
  if [ -n "$NGINX_PID" ] && kill -0 "$NGINX_PID" 2>/dev/null; then
    kill -TERM "$NGINX_PID" 2>/dev/null || true
  fi
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill -TERM "$API_PID" 2>/dev/null || true
  fi
  wait
  echo "[entrypoint] shutdown complete."
  exit "$EXIT_CODE"
}

trap 'cleanup 0' TERM INT HUP QUIT

# Launch Go backend API on 127.0.0.1:3000
echo "[entrypoint] starting Go backend on $APP_HOST:$APP_PORT..."
/app/ponta-api &
API_PID=$!

# Launch Nginx in background on 0.0.0.0:8080
echo "[entrypoint] starting Nginx on 0.0.0.0:8080..."
nginx -g "daemon off;" &
NGINX_PID=$!

# Supervisor loop: monitor both processes; if either crashes, exit
while true; do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "[entrypoint] ERROR: Go backend exited unexpectedly."
    cleanup 1
  fi

  if ! kill -0 "$NGINX_PID" 2>/dev/null; then
    echo "[entrypoint] ERROR: Nginx exited unexpectedly."
    cleanup 1
  fi

  sleep 2
done
