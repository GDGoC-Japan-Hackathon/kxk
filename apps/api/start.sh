#!/usr/bin/env sh
set -eu

PORT="${PORT:-8080}"
DEFAULT_DB_PATH="/tmp/worldlens.db"
BUNDLED_DB_PATH="/app/worldlens.db"

if [ -z "${WORLDLENS_DB_PATH:-}" ]; then
  export WORLDLENS_DB_PATH="$DEFAULT_DB_PATH"
fi

if [ ! -f "$WORLDLENS_DB_PATH" ] && [ -f "$BUNDLED_DB_PATH" ]; then
  cp "$BUNDLED_DB_PATH" "$WORLDLENS_DB_PATH"
fi

exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
