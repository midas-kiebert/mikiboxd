#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}/backend"

# Keep this test opt-in and live-only.
export RUN_LIVE_TMDB_RESOLUTION_CASES=1
# Avoid config parse errors when DEBUG is set to non-boolean values in the shell env.
export DEBUG="${DEBUG:-false}"

exec .venv/bin/pytest \
  --noconftest \
  tests/scraping/test_tmdb_candidate_scoring.py::test_tmdb_resolution_cases_from_json \
  "$@"
