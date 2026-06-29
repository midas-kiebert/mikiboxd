#!/usr/bin/env bash
#
# Launch the web frontend (Vite dev server) against a chosen backend.
#
# Usage:
#   scripts/web-dev.sh [staging|prod|local]   # default: staging
#
# staging / prod target the deployed backends. Because their CORS allowlists do
# not include localhost, we don't point the client straight at them — instead the
# Vite dev server proxies /api/* to the remote backend (see vite.config.ts), so
# the browser only ever talks to its own localhost origin. Auth tokens live in
# localStorage (not cookies), so nothing else is needed to use the remote DB.
#
# local talks to a backend running on http://localhost:8000 directly.

set -euo pipefail

TARGET_ENV="${1:-staging}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$TARGET_ENV" in
  staging)
    BACKEND="https://api.staging.mikino.nl"
    ;;
  prod|production)
    BACKEND="https://api.mikino.nl"
    ;;
  local)
    BACKEND="http://localhost:8000"
    ;;
  *)
    echo "Unknown target '$TARGET_ENV'. Use: staging | prod | local" >&2
    exit 1
    ;;
esac

echo "▶ Web dev server → ${TARGET_ENV} backend (${BACKEND})"

cd "$REPO_ROOT/frontend"

if [ "$TARGET_ENV" = "local" ]; then
  # Same-machine backend: hit it directly, no proxy needed.
  exec pnpm dev --open
else
  # Remote backend: proxy /api through Vite to dodge CORS. Empty VITE_API_URL
  # makes the generated client issue relative (same-origin) requests.
  VITE_API_URL="" VITE_API_PROXY_TARGET="$BACKEND" exec pnpm dev --open
fi
