#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

usage() {
  echo "Usage: ALLOW_DATABASE_RESTORE=1 pnpm run db:restore -- <archive.dump> --confirm-database <database-name>" >&2
  exit 2
}
if [[ $# -ne 3 || "$2" != "--confirm-database" ]]; then usage; fi
if [[ "${ALLOW_DATABASE_RESTORE:-}" != "1" ]]; then
  echo "Restore is destructive. Set ALLOW_DATABASE_RESTORE=1 and confirm the exact database name." >&2
  exit 1
fi
if [[ "${NODE_ENV:-}" == "production" ]]; then
  echo "This helper is restricted to local Docker Compose databases; use the production database provider's restore procedure." >&2
  exit 1
fi

COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.yml}"
DATABASE_URL="${DATABASE_URL:-}"
if [[ -z "$DATABASE_URL" ]]; then
  echo "DATABASE_URL must be set (root .env is loaded by pnpm db:restore)." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker with the Compose plugin is required." >&2
  exit 1
fi

DB_HOST="$(node -e 'const u = new URL(process.env.DATABASE_URL); if (!["postgres:", "postgresql:"].includes(u.protocol)) process.exit(2); process.stdout.write(u.hostname)')"
DB_PORT="$(node -e 'const u = new URL(process.env.DATABASE_URL); process.stdout.write(u.port || "5432")')"
DB_USER="$(node -e 'const u = new URL(process.env.DATABASE_URL); process.stdout.write(decodeURIComponent(u.username))')"
DB_NAME="$(node -e 'const u = new URL(process.env.DATABASE_URL); process.stdout.write(decodeURIComponent(u.pathname.replace(/^\\//, "")))')"

case "$DB_HOST" in
  localhost|127.0.0.1|::1) ;;
  *) echo "These restore scripts only target the local Docker Compose PostgreSQL service." >&2; exit 1 ;;
esac
if [[ "$DB_PORT" != "5432" || -z "$DB_NAME" ]]; then
  echo "DATABASE_URL must target the local PostgreSQL service on port 5432 and name a database." >&2
  exit 1
fi
if [[ "$DB_NAME" == "postgres" || "$DB_NAME" == "template0" || "$DB_NAME" == "template1" ]]; then
  echo "Refusing to restore into a PostgreSQL system database." >&2
  exit 1
fi
if [[ "$DB_NAME" != "$3" ]]; then
  echo "Database confirmation does not match DATABASE_URL target ($DB_NAME)." >&2
  exit 1
fi

COMPOSE_PATH="$ROOT/$COMPOSE_FILE"
compose=(docker compose -f "$COMPOSE_PATH")
if ! "${compose[@]}" ps --status running --services | grep -qx postgres; then
  echo "PostgreSQL Compose service is not running." >&2
  exit 1
fi
CONTAINER_USER="$("${compose[@]}" exec -T postgres printenv POSTGRES_USER | tr -d '\\r\\n')"
if [[ "$DB_USER" != "$CONTAINER_USER" ]]; then
  echo "DATABASE_URL user must match POSTGRES_USER in the Compose service." >&2
  exit 1
fi

ARCHIVE="$1"
if [[ "$ARCHIVE" != /* ]]; then ARCHIVE="$ROOT/$ARCHIVE"; fi
if [[ ! -s "$ARCHIVE" || ! -s "$ARCHIVE.sha256" ]]; then
  echo "Archive or SHA-256 sidecar is missing: $ARCHIVE" >&2
  exit 1
fi
EXPECTED_SHA="$(tr -d '[:space:]' < "$ARCHIVE.sha256")"
if [[ ! "$EXPECTED_SHA" =~ ^[a-fA-F0-9]{64}$ ]]; then
  echo "Invalid SHA-256 sidecar." >&2
  exit 1
fi
ACTUAL_SHA="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
if [[ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]]; then
  echo "Backup checksum mismatch; refusing to restore." >&2
  exit 1
fi

cat "$ARCHIVE" | "${compose[@]}" exec -T postgres pg_restore --list - >/dev/null
echo "Restoring into '$DB_NAME'. Objects included in the archive may be replaced."
cat "$ARCHIVE" | "${compose[@]}" exec -T postgres sh -c \
  'pg_restore --clean --if-exists --no-owner --no-acl --single-transaction --exit-on-error --username="$POSTGRES_USER" --dbname="$1" -' \
  sh "$DB_NAME"

echo "PostgreSQL restore completed and archive checksum verified."
echo "Run application smoke tests and validate the restored dataset before reopening traffic."
