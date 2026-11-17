#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.yml}"
DATABASE_URL="${DATABASE_URL:-}"
if [[ -z "$DATABASE_URL" ]]; then
  echo "DATABASE_URL must be set (root .env is loaded by pnpm db:backup)." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker with the Compose plugin is required." >&2
  exit 1
fi

DB_HOST="$(node -e 'const u = new URL(process.env.DATABASE_URL); if (!["postgres:", "postgresql:"].includes(u.protocol)) process.exit(2); process.stdout.write(u.hostname)')"
DB_PORT="$(node -e 'const u = new URL(process.env.DATABASE_URL); process.stdout.write(u.port || "5432")')"
DB_USER="$(node -e 'const u = new URL(process.env.DATABASE_URL); process.stdout.write(decodeURIComponent(u.username))')"
DB_NAME="$(node -e 'const u = new URL(process.env.DATABASE_URL); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))')"

case "$DB_HOST" in
  localhost|127.0.0.1|::1) ;;
  *) echo "These backup scripts only target the local Docker Compose PostgreSQL service." >&2; exit 1 ;;
esac
if [[ "$DB_PORT" != "5432" || -z "$DB_NAME" ]]; then
  echo "DATABASE_URL must target the local PostgreSQL service on port 5432 and name a database." >&2
  exit 1
fi

if [[ "$COMPOSE_FILE" = /* ]]; then COMPOSE_PATH="$COMPOSE_FILE"; else COMPOSE_PATH="$ROOT/$COMPOSE_FILE"; fi
compose=(docker compose -f "$COMPOSE_PATH")
if ! "${compose[@]}" ps --status running --services | grep -qx postgres; then
  echo "PostgreSQL Compose service is not running. Start it with: docker compose -f $COMPOSE_FILE up -d postgres" >&2
  exit 1
fi
CONTAINER_USER="$("${compose[@]}" exec -T postgres printenv POSTGRES_USER | tr -d '\r\n')"
if [[ "$DB_USER" != "$CONTAINER_USER" ]]; then
  echo "DATABASE_URL user must match POSTGRES_USER in the Compose service." >&2
  exit 1
fi

if [[ "${1:-}" == "--" ]]; then shift; fi
if [[ $# -gt 1 ]]; then
  echo "Usage: pnpm run db:backup -- [archive-path]" >&2
  exit 2
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="${1:-backups/questoria-$STAMP.dump}"
if [[ "$OUTPUT" != /* ]]; then OUTPUT="$ROOT/$OUTPUT"; fi
mkdir -p "$(dirname "$OUTPUT")"
if [[ -e "$OUTPUT" || -e "$OUTPUT.sha256" ]]; then
  echo "Backup target already exists; refusing to overwrite it: $OUTPUT" >&2
  exit 1
fi

umask 077
cleanup_on_error() {
  local exit_code=$?
  if [[ $exit_code -ne 0 ]]; then
    rm -f "$OUTPUT" "$OUTPUT.sha256"
  fi
  exit "$exit_code"
}
trap cleanup_on_error EXIT

"${compose[@]}" exec -T postgres sh -c \
  'pg_dump --format=custom --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$1"' \
  sh "$DB_NAME" > "$OUTPUT"

if [[ ! -s "$OUTPUT" ]]; then
  echo "pg_dump produced an empty archive." >&2
  exit 1
fi
cat "$OUTPUT" | "${compose[@]}" exec -T postgres pg_restore --list >/dev/null
shasum -a 256 "$OUTPUT" | awk '{print $1}' > "$OUTPUT.sha256"
chmod 600 "$OUTPUT" "$OUTPUT.sha256"
trap - EXIT

echo "PostgreSQL backup created and verified:"
echo "  archive: $OUTPUT"
echo "  sha256:  $(cat "$OUTPUT.sha256")"
echo "  database: $DB_NAME"
