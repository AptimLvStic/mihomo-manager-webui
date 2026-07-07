#!/usr/bin/env sh
set -eu

SOURCE_KEY="${MIHOMO_KEY_FILE:-${MIHOMO_KEY:-}}"

if [ -n "$SOURCE_KEY" ] && [ -f "$SOURCE_KEY" ]; then
  TARGET_KEY="/tmp/mihomo_ssh_key"
  cp "$SOURCE_KEY" "$TARGET_KEY"
  chmod 600 "$TARGET_KEY"
  export MIHOMO_KEY="$TARGET_KEY"
fi

exec "$@"
