#!/usr/bin/env bash
#
# The whole app on this machine, against a copy of the production database.
#
#   scripts/local-stack.sh up           # Postgres + backend + Vite, seeded from prod
#   scripts/local-stack.sh up --reseed  # ...and pull a fresh copy of prod first
#   scripts/local-stack.sh down         # stop all three (keeps the data)
#   scripts/local-stack.sh down --wipe  # ...and delete the database container
#   scripts/local-stack.sh status       # what is up, and what is in the database
#   scripts/local-stack.sh logs [backend|frontend]
#
# Why a copy of prod and not an empty database: every screen on the website is
# a feed, and a feed with no showtimes in it cannot be looked at. The staging
# database is *not* a substitute — its `movie` and `showtime` tables are
# normally empty, because the staging deploy only reseeds the user-data tables.
#
# The database is a throwaway container rather than a system Postgres, so it
# cannot collide with anything else and `down --wipe` really is the end of it.
# It holds real production data while it is up: real names, real email
# addresses. Wipe it when you are done with it.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO_ROOT"

# --- Where things live ------------------------------------------------------

PG_CONTAINER=cinema_test_pg
PG_IMAGE=postgres:17          # Matches production; a custom-format dump needs
                              # a restore at least as new as the dump.
PG_PORT=5432
BACKEND_PORT=8000
# 5173 and not a spare port: BACKEND_CORS_ORIGINS in .env lists exactly this
# origin, and frontend/.env already points VITE_API_URL at localhost:8000.
FRONTEND_PORT=5173

# Production runs on the same box as the CI runner; `mikiboxd-db-1` is prod's
# database and `mikiboxd-staging-db-1` is staging's. See scripts/deploy-staging.sh.
PROD_HOST=mi-ki
PROD_DB_CONTAINER=mikiboxd-db-1

RUN_DIR=${TMPDIR:-/tmp}/mikino-local-stack
mkdir -p "$RUN_DIR"

say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!  %s\033[0m\n' "$*" >&2; }
die() { printf '\033[1;31m✗  %s\033[0m\n' "$*" >&2; exit 1; }

env_value() {
  # Reads one key out of .env without sourcing it — the file has values with
  # spaces and quotes in them that a `source` would try to execute.
  local value
  value=$(grep -m1 "^$1=" "$REPO_ROOT/.env" | cut -d= -f2- | sed 's/^"//; s/"$//' || true)
  [ -n "$value" ] || die "$1 is not set in $REPO_ROOT/.env"
  printf '%s' "$value"
}

# --- Database ---------------------------------------------------------------

pg_running() { [ "$(docker inspect -f '{{.State.Running}}' "$PG_CONTAINER" 2>/dev/null)" = "true" ]; }
pg_exists()  { docker inspect "$PG_CONTAINER" >/dev/null 2>&1; }

start_pg() {
  if pg_running; then
    say "Postgres already up ($PG_CONTAINER)"
    return
  fi
  if pg_exists; then
    say "Starting the existing $PG_CONTAINER"
    docker start "$PG_CONTAINER" >/dev/null
  else
    say "Creating $PG_CONTAINER on 127.0.0.1:$PG_PORT"
    docker run -d --name "$PG_CONTAINER" \
      -p "127.0.0.1:$PG_PORT:5432" \
      -e POSTGRES_USER=postgres \
      -e POSTGRES_PASSWORD="$(env_value POSTGRES_PASSWORD)" \
      -e POSTGRES_DB=app \
      "$PG_IMAGE" >/dev/null
  fi

  printf '   waiting for Postgres'
  for _ in $(seq 1 60); do
    if docker exec "$PG_CONTAINER" pg_isready -U postgres -q 2>/dev/null; then
      printf ' ready\n'; return
    fi
    printf '.'; sleep 1
  done
  printf '\n'; die "Postgres did not come up; try: docker logs $PG_CONTAINER"
}

showtime_count() {
  docker exec "$PG_CONTAINER" psql -U postgres -d app -tA \
    -c 'select count(*) from showtime' 2>/dev/null || echo 0
}

seed_from_prod() {
  local dump="$RUN_DIR/prod.dump"

  say "Dumping production from $PROD_HOST:$PROD_DB_CONTAINER"
  ssh -o BatchMode=yes "$PROD_HOST" \
    "docker exec $PROD_DB_CONTAINER pg_dump -U postgres -d app -Fc --no-owner --no-acl" \
    > "$dump" || die "could not reach production over ssh $PROD_HOST"
  [ -s "$dump" ] || die "the production dump came back empty"
  printf '   %s\n' "$(du -h "$dump" | cut -f1) dumped"

  say "Restoring into $PG_CONTAINER"
  # Dropping and recreating rather than restoring over the top: a partial
  # restore onto existing rows is how you get a database that looks fine and
  # is missing half a table.
  docker exec "$PG_CONTAINER" psql -U postgres -d postgres -q \
    -c 'drop database if exists app with (force)' -c 'create database app'
  docker exec -i "$PG_CONTAINER" pg_restore -U postgres -d app --no-owner --no-acl < "$dump"
  rm -f "$dump"

  # Production runs `master`; this checkout is usually `dev`, which can be one
  # or more migrations ahead of it.
  say "Bringing the schema up to this branch"
  ( cd "$REPO_ROOT/backend" \
    && find app/alembic/versions -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null \
    ; .venv/bin/python -m alembic upgrade head )
}

# --- Services ---------------------------------------------------------------

# Whoever is listening on a port, or nothing. The `|| true` is load-bearing:
# under `set -o pipefail` a `grep` that matches nothing fails the pipeline, and
# `pid=$(port_pid …)` then fails the assignment, which `set -e` turns into a
# silent exit — `down` stopped after the first service and printed nothing.
port_pid() {
  ss -ltnpH "sport = :$1" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true
}

start_backend() {
  if [ -n "$(port_pid $BACKEND_PORT)" ]; then
    say "Backend already up on :$BACKEND_PORT"; return
  fi
  say "Starting the backend on :$BACKEND_PORT"
  # `setsid --fork`, and no trailing `&`. Two traps, both of which looked like
  # "the script hangs even though the service started fine":
  #   - A `&` leaves a forked shell behind that holds this script's stdout, so
  #     `scripts/local-stack.sh up | tail` never reaches the prompt.
  #   - Plain `setsid` only forks when it is not already a process group
  #     leader; when it is, it *execs* the service and the subshell becomes it,
  #     in the foreground, forever. `--fork` makes that unconditional.
  ( cd "$REPO_ROOT/backend" \
    && setsid --fork .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" \
       > "$RUN_DIR/backend.log" 2>&1 < /dev/null )
  for _ in $(seq 1 40); do
    curl -sf -m 2 "http://127.0.0.1:$BACKEND_PORT/api/v1/utils/health-check/" >/dev/null && return
    sleep 1
  done
  warn "backend did not answer its health check — see $RUN_DIR/backend.log"
}

start_frontend() {
  if [ -n "$(port_pid $FRONTEND_PORT)" ]; then
    say "Frontend already up on :$FRONTEND_PORT"; return
  fi
  say "Starting the Vite dev server on :$FRONTEND_PORT"
  ( cd "$REPO_ROOT/frontend" \
    && setsid --fork pnpm dev --port "$FRONTEND_PORT" --strictPort \
       > "$RUN_DIR/frontend.log" 2>&1 < /dev/null )
  for _ in $(seq 1 40); do
    curl -sf -m 2 -o /dev/null "http://localhost:$FRONTEND_PORT/" && return
    sleep 1
  done
  warn "Vite did not answer — see $RUN_DIR/frontend.log"
  warn "the TanStack 'expected route id to be a string literal' errors on startup are pre-existing noise"
}

stop_service() {
  local name=$1 port=$2 pid
  # The port is the only thing consulted. `setsid` and pnpm's wrapper both
  # mean the pid this script started is not the process actually listening, so
  # there is no pid file to go stale. Never `pkill -f vite` — the user's own
  # dev server is usually running too.
  pid=$(port_pid "$port")
  [ -z "$pid" ] && return

  say "Stopping $name (pid $pid on :$port)"
  # The process group first, since Vite's server is a child of pnpm; the bare
  # pid as a fallback for one started by hand without a group of its own.
  kill -TERM "-$(ps -o pgid= "$pid" 2>/dev/null | tr -d ' ')" 2>/dev/null \
    || kill -TERM "$pid" 2>/dev/null || true

  for _ in $(seq 1 20); do
    [ -z "$(port_pid "$port")" ] && break
    sleep 0.5
  done
  pid=$(port_pid "$port")
  if [ -n "$pid" ]; then
    warn "$name would not stop; killing pid $pid"
    kill -9 "$pid" 2>/dev/null || true
  fi
  # Explicit, because an `if` whose test fails leaves that failure as the
  # function's exit status — and under `set -e` that aborted the whole `down`
  # after the first service it stopped.
  return 0
}

# --- Commands ---------------------------------------------------------------

cmd_up() {
  local reseed=false
  [ "${1:-}" = "--reseed" ] && reseed=true

  start_pg
  if $reseed || [ "$(showtime_count)" = "0" ]; then
    seed_from_prod
  else
    say "Database already holds $(showtime_count) showtimes — pass --reseed to refresh it"
  fi
  start_backend
  start_frontend

  say "Up"
  cat <<EOF
   web       http://localhost:$FRONTEND_PORT
   api       http://127.0.0.1:$BACKEND_PORT/docs
   database  postgres://postgres@127.0.0.1:$PG_PORT/app  ($PG_CONTAINER)
   logs      $RUN_DIR

   Sign in with your own production account — its password came across with
   the dump. Stop everything with: scripts/local-stack.sh down
EOF
}

cmd_down() {
  stop_service frontend "$FRONTEND_PORT"
  stop_service backend "$BACKEND_PORT"
  if pg_exists; then
    if [ "${1:-}" = "--wipe" ]; then
      say "Removing $PG_CONTAINER and the production data in it"
      docker rm -f "$PG_CONTAINER" >/dev/null
    else
      say "Stopping $PG_CONTAINER (data kept; --wipe removes it)"
      docker stop "$PG_CONTAINER" >/dev/null
    fi
  fi
  say "Down"
}

cmd_status() {
  printf 'postgres  %s\n' "$(pg_running && echo "up ($PG_CONTAINER)" || echo down)"
  printf 'backend   %s\n' "$([ -n "$(port_pid $BACKEND_PORT)" ] && echo "up on :$BACKEND_PORT" || echo down)"
  printf 'frontend  %s\n' "$([ -n "$(port_pid $FRONTEND_PORT)" ] && echo "up on :$FRONTEND_PORT" || echo down)"
  if pg_running; then
    docker exec "$PG_CONTAINER" psql -U postgres -d app -tA -c \
      "select 'showtimes ' || (select count(*) from showtime)
            || ', movies ' || (select count(*) from movie)
            || ', users ' || (select count(*) from \"user\")
            || ', schema ' || (select version_num from alembic_version);" 2>/dev/null \
      | sed '/^$/d; s/^/data      /'
  fi
}

case "${1:-up}" in
  up)     shift || true; cmd_up "${1:-}" ;;
  down)   shift || true; cmd_down "${1:-}" ;;
  status) cmd_status ;;
  logs)   tail -f "$RUN_DIR/${2:-backend}.log" ;;
  *)      die "usage: $(basename "$0") [up [--reseed] | down [--wipe] | status | logs [backend|frontend]]" ;;
esac
