#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_TYPE="${2:-${1:-debug}}"

exec "$SCRIPT_DIR/build-android.sh" apk "$BUILD_TYPE"
