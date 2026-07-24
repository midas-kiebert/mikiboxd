#!/usr/bin/env bash
# Single end-of-change script: auto-fixes and type-checks backend, frontend, and mobile.
# Run this yourself after a change is otherwise done - not meant to be run repeatedly during work.
# Test files are intentionally skipped for lint/type checks (noisy, low value).
# Errors only - warnings are hidden here, run scripts/check-strict.sh before a dev->master merge to see/fail on those too.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0

run_step() {
  local label="$1"
  shift
  echo "==> ${label}"
  if ! "$@"; then
    echo "!!! ${label} failed"
    FAILED=1
  fi
}

# --- Backend (ruff + mypy, app/ only - tests/ excluded on purpose) ---
cd "${ROOT_DIR}/backend"
run_step "backend: ruff check --fix" .venv/bin/ruff check app scripts --fix
run_step "backend: ruff format" .venv/bin/ruff format app scripts
run_step "backend: mypy" .venv/bin/mypy app

# --- Frontend (biome + tsc, tests/ excluded via tsconfig.build.json) ---
cd "${ROOT_DIR}/frontend"
run_step "frontend: biome fix" npx biome check --write --unsafe --no-errors-on-unmatched --files-ignore-unknown=true --diagnostic-level=error ./
run_step "frontend: tsc" npx tsc -p tsconfig.build.json --noEmit

# --- Mobile (eslint + tsc) ---
cd "${ROOT_DIR}/mobile"
run_step "mobile: eslint --fix" npx expo lint --fix --quiet
run_step "mobile: tsc" npx tsc --noEmit

cd "${ROOT_DIR}"

if [ "${FAILED}" -ne 0 ]; then
  echo
  echo "One or more checks failed. Fix the remaining errors above, or ask the check-fixer subagent."
  exit 1
fi

echo
echo "All checks passed."
