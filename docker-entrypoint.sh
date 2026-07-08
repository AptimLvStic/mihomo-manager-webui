#!/usr/bin/env sh
set -eu

SOURCE_KEY="${MIHOMO_KEY_FILE:-${MIHOMO_KEY:-}}"
AUTH_MODE="${MIHOMO_AUTH:-}"
RUN_MODE="${MIHOMO_MODE:-remote}"
USE_KEY=0

if [ "$RUN_MODE" != "local" ]; then
  if [ "$AUTH_MODE" = "key" ]; then
    USE_KEY=1
  elif [ -z "$AUTH_MODE" ] && [ -z "${MIHOMO_PASSWORD:-}" ]; then
    USE_KEY=1
  fi
fi

if [ "$USE_KEY" = "1" ] && [ -n "$SOURCE_KEY" ] && [ -f "$SOURCE_KEY" ]; then
  TARGET_KEY="/tmp/mihomo_ssh_key"
  cp "$SOURCE_KEY" "$TARGET_KEY"
  chmod 600 "$TARGET_KEY"
  export MIHOMO_KEY="$TARGET_KEY"
fi

exec "$@"
