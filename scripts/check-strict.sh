#!/usr/bin/env bash
# Stricter pass for before a dev->master merge: same checks as check.sh, but warnings
# are shown and fail the build too (biome stylistic findings, eslint exhaustive-deps, etc).
# Test files are intentionally skipped for lint/type checks (noisy, low value).

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
run_step "frontend: biome fix" npx biome check --write --unsafe --no-errors-on-unmatched --files-ignore-unknown=true --error-on-warnings ./
run_step "frontend: tsc" npx tsc -p tsconfig.build.json --noEmit

# --- Mobile (eslint + tsc) ---
cd "${ROOT_DIR}/mobile"
run_step "mobile: eslint --fix" npx expo lint --fix --max-warnings 0
run_step "mobile: tsc" npx tsc --noEmit

cd "${ROOT_DIR}"

if [ "${FAILED}" -ne 0 ]; then
  echo
  echo "One or more checks failed. Fix the remaining errors/warnings above, or ask the check-fixer subagent."
  exit 1
fi

echo
echo "All checks passed (strict)."
