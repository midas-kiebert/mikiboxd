#! /usr/bin/env bash
# Deploys your LOCAL working tree to staging, independent of what's pushed to
# GitHub/dev. Rsyncs the repo straight to the self-hosted runner's checkout on
# mi-ki, then rebuilds/restarts the staging stack there over SSH, skipping
# git checkout entirely.
#
# By default this only rebuilds and restarts containers. Pass --with-reseed
# to also run the prod->staging user-data copy that the real
# .github/workflows/deploy-staging.yml does on every push to dev — that step
# is slow and has caused staging outages before (see that workflow's
# comments), so it's opt-in here rather than the default.
set -euo pipefail

RESEED_DB=false
for arg in "$@"; do
  case "$arg" in
    --with-reseed) RESEED_DB=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

REMOTE_HOST=mi-ki
REMOTE_DIR=/home/github/actions-runner/_work/mikiboxd/mikiboxd
REPO_ROOT=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)

echo "Syncing local working tree to $REMOTE_HOST:$REMOTE_DIR ..."
rsync -az --delete \
  --filter=':- .gitignore' \
  --exclude=".git" \
  --exclude=".env" \
  --exclude="mobile/" \
  "$REPO_ROOT/" "$REMOTE_HOST:$REMOTE_DIR/"

echo "Deploying on $REMOTE_HOST (reseed: $RESEED_DB) ..."
ssh "$REMOTE_HOST" "RESEED_DB=$RESEED_DB bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail
cd /home/github/actions-runner/_work/mikiboxd/mikiboxd

# .env already exists on the box (secrets baked in from the last real
# workflow run) and is excluded from the rsync above, so it's reused as-is.
export $(grep -E '^(POSTGRES_USER|POSTGRES_DB)=' .env | xargs)

docker compose -f docker-compose.yml --project-name mikiboxd-staging build

wait_healthy() {
  local container="$1"
  for i in $(seq 1 30); do
    if [ "$(docker inspect -f '{{.State.Health.Status}}' "$container")" = "healthy" ]; then
      echo "$container healthy"; return 0
    fi
    echo "waiting for $container... ($i)"; sleep 2
  done
  echo "$container did not become healthy" >&2
  return 1
}

if [ "$RESEED_DB" != "true" ]; then
  echo "Skipping DB reseed; rebuilding and restarting containers only ..."
  docker compose -f docker-compose.yml --project-name mikiboxd-staging up --detach
  wait_healthy mikiboxd-staging-backend-1 || {
    docker compose -f docker-compose.yml --project-name mikiboxd-staging logs prestart backend --no-color --tail 200
    exit 1
  }
  echo "Deploy complete (no reseed)."
  exit 0
fi

echo "Stopping staging app containers before the database copy ..."
docker compose -f docker-compose.yml --project-name mikiboxd-staging stop backend scheduler frontend adminer

echo "Starting staging database ..."
docker compose -f docker-compose.yml --project-name mikiboxd-staging up --detach db
wait_healthy mikiboxd-staging-db-1

echo "Copying user-generated data from production into staging ..."
USER_DATA_TABLES=(
  letterboxd
  user user_login_email userblock userreport
  friendship friendrequest
  userletterboxdlist
  cinemaselection cinemapreset savedpreset
  notification
  watchlistselection watchedselection showtimeselection
  showtimeping showtimepinglink showtimereport
  showtimevisibilitysetting showtimevisibilityeffective
  soldoutwatch
  watchlistdigestqueueentry watchlistdigestnotifiedmovie
  analyticsevent
)
QUOTED_TABLES=()
for t in "${USER_DATA_TABLES[@]}"; do
  QUOTED_TABLES+=("\"$t\"")
done
QUOTED_TABLES+=("pushtoken")

docker exec mikiboxd-staging-db-1 psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v ON_ERROR_STOP=1 \
  -c "TRUNCATE TABLE $(IFS=,; echo "${QUOTED_TABLES[*]}") CASCADE;"

copy_table_common_columns() {
  local table="$1"
  local cols
  cols=$(comm -12 \
    <(docker exec mikiboxd-staging-db-1 psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c \
        "SELECT column_name FROM information_schema.columns WHERE table_name='$table' ORDER BY column_name;" | sort) \
    <(docker exec mikiboxd-db-1 psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c \
        "SELECT column_name FROM information_schema.columns WHERE table_name='$table' ORDER BY column_name;" | sort) \
    | paste -sd, -)

  if [ -z "$cols" ]; then
    echo "WARNING: $table has no columns in common between production and staging; skipping"
    return
  fi

  local tsv="/tmp/reseed_${table}.tsv"
  docker exec mikiboxd-db-1 psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "\\copy (SELECT $cols FROM \"$table\") TO STDOUT" > "$tsv"
  docker cp "$tsv" "mikiboxd-staging-db-1:$tsv"
  rm -f "$tsv"

  docker exec -i mikiboxd-staging-db-1 psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
    -c "CREATE TEMP TABLE tmp_copy AS SELECT $cols FROM \"$table\" WITH NO DATA;" \
    -c "\\copy tmp_copy FROM '$tsv'" \
    -c "DO \$do\$ DECLARE r tmp_copy%ROWTYPE; copied int := 0; skipped int := 0; BEGIN FOR r IN SELECT * FROM tmp_copy LOOP BEGIN INSERT INTO \"$table\" ($cols) SELECT (r).*; copied := copied + 1; EXCEPTION WHEN OTHERS THEN skipped := skipped + 1; END; END LOOP; RAISE NOTICE '$table: copied %, skipped %', copied, skipped; END \$do\$;" \
    -c "DROP TABLE tmp_copy;"

  docker exec mikiboxd-staging-db-1 rm -f "$tsv"
}

for t in "${USER_DATA_TABLES[@]}"; do
  copy_table_common_columns "$t" || echo "WARNING: Failed to copy $t from production, continuing"
done

echo "Bumping sequences for copied tables ..."
for t in "${USER_DATA_TABLES[@]}"; do
  has_id_column=$(docker exec mikiboxd-staging-db-1 psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c \
    "SELECT 1 FROM information_schema.columns WHERE table_name='$t' AND column_name='id';")
  if [ "$has_id_column" != "1" ]; then
    continue
  fi
  seq=$(docker exec mikiboxd-staging-db-1 psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c \
    "SELECT pg_get_serial_sequence('$t', 'id');")
  if [ -n "$seq" ]; then
    docker exec mikiboxd-staging-db-1 psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c \
      "SELECT setval('$seq', COALESCE((SELECT MAX(id) FROM \"$t\"), 1));"
  fi
done

echo "Restarting the staging app ..."
docker compose -f docker-compose.yml --project-name mikiboxd-staging up --detach
wait_healthy mikiboxd-staging-backend-1 || {
  docker compose -f docker-compose.yml --project-name mikiboxd-staging logs prestart backend --no-color --tail 200
  exit 1
}

echo "Making Test User friends with everyone in staging ..."
docker exec mikiboxd-staging-db-1 psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
INSERT INTO friendship (user_id, friend_id, shares_status)
SELECT u.id, t.id, true FROM \"user\" u, \"user\" t
WHERE t.email = 'test@midaskiebert.nl' AND u.id != t.id
ON CONFLICT DO NOTHING;
INSERT INTO friendship (user_id, friend_id, shares_status)
SELECT t.id, u.id, true FROM \"user\" u, \"user\" t
WHERE t.email = 'test@midaskiebert.nl' AND u.id != t.id
ON CONFLICT DO NOTHING;
"

echo "Rebuilding friend-status visibility cache for everyone ..."
docker exec mikiboxd-staging-backend-1 python scripts/rebuild-all-visibility.py

echo "Deploy complete (with reseed)."
REMOTE_SCRIPT
