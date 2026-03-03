#!/usr/bin/env bash

set -euo pipefail
set -x

# Normalize common non-boolean DEBUG values from dev tooling.
if [[ "${DEBUG:-}" == "release" ]]; then
  export DEBUG=false
fi
export DEBUG="${DEBUG:-false}"
export TESTING=true

PYTHON_BIN="${PYTHON_BIN:-python}"
COVERAGE_BIN="${COVERAGE_BIN:-coverage}"
if [ -x ".venv/bin/python" ]; then
  PYTHON_BIN=".venv/bin/python"
fi
if [ -x ".venv/bin/coverage" ]; then
  COVERAGE_BIN=".venv/bin/coverage"
fi
COVERAGE_HTML_DIR="${COVERAGE_HTML_DIR:-.coverage_html}"
COVERAGE_HTML_TITLE="${COVERAGE_HTML_TITLE:-coverage}"

# Start local Postgres for tests when Docker is available.
if command -v docker >/dev/null 2>&1 && [ -f ../docker-compose.yml ]; then
  if docker info >/dev/null 2>&1; then
    (
      cd ..
      docker compose up -d db
    )
  fi
fi

# Wait for database connectivity. Migrations for the test DB are applied in tests/conftest.py.
"${PYTHON_BIN}" app/tests_pre_start.py

"${COVERAGE_BIN}" run --source=app -m pytest "$@"
"${COVERAGE_BIN}" report --show-missing
if ! "${COVERAGE_BIN}" html -d "${COVERAGE_HTML_DIR}" --title "${COVERAGE_HTML_TITLE}"; then
  echo "Skipping HTML coverage report generation."
fi
