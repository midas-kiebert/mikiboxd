#! /usr/bin/env bash
# Runs on mi-ki via cron (see setup instructions in the deploy-staging skill/
# README). Prunes unused Docker state left behind by repeated builds/deploys,
# then emails mikino@midaskiebert.nl if root disk usage is still over
# threshold afterwards. Reuses the SMTP creds already baked into the staging
# .env rather than needing a separate mail setup.
set -euo pipefail

THRESHOLD=85
ALERT_EMAIL="mikino@midaskiebert.nl"
ENV_FILE=/home/github/actions-runner/_work/mikiboxd/mikiboxd/.env

echo "[$(date -Is)] Pruning unused Docker state..."
docker container prune -f --filter "until=24h" >/dev/null
docker image prune -f >/dev/null
docker builder prune -f --filter "until=72h" >/dev/null

USAGE=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
echo "[$(date -Is)] Root disk usage: ${USAGE}%"

if [ "$USAGE" -lt "$THRESHOLD" ]; then
  exit 0
fi

echo "[$(date -Is)] Usage >= ${THRESHOLD}%, sending alert email..."

SMTP_HOST=$(grep -E '^SMTP_HOST=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')
SMTP_USER=$(grep -E '^SMTP_USER=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')
SMTP_PASSWORD=$(grep -E '^SMTP_PASSWORD=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')
SMTP_PORT=$(grep -E '^SMTP_PORT=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')

MAIL_FILE=$(mktemp)
trap 'rm -f "$MAIL_FILE"' EXIT

{
  echo "Subject: [mi-ki] Disk usage at ${USAGE}% - cleanup needed"
  echo "From: $SMTP_USER"
  echo "To: $ALERT_EMAIL"
  echo "Content-Type: text/plain; charset=UTF-8"
  echo
  echo "Root disk usage on mi-ki is at ${USAGE}% (alert threshold ${THRESHOLD}%),"
  echo "even after pruning unused Docker images/containers/build cache."
  echo
  df -h /
  echo
  docker system df
} > "$MAIL_FILE"

curl --silent --show-error \
  --url "smtp://${SMTP_HOST}:${SMTP_PORT}" \
  --ssl-reqd \
  --mail-from "$SMTP_USER" \
  --mail-rcpt "$ALERT_EMAIL" \
  --user "${SMTP_USER}:${SMTP_PASSWORD}" \
  --upload-file "$MAIL_FILE"
