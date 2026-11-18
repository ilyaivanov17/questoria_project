#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="${1:---tools}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.yml}"
compose=(docker compose -f "$COMPOSE_FILE")

case "$MODE" in
  --tools|--database|--services) ;;
  *)
    echo "Usage: bash scripts/check-environment.sh [--tools|--database|--services]" >&2
    exit 2
    ;;
esac

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command is missing: $1" >&2
    exit 1
  fi
}

require_command node
require_command pnpm
require_command docker

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major !== 22 || minor < 12) {
    console.error("Questoria requires Node.js >=22.12 and <23; found " + process.versions.node);
    process.exit(1);
  }
'

EXPECTED_PNPM="$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '')")"
ACTUAL_PNPM="$(pnpm --version)"
if [[ "$ACTUAL_PNPM" != "$EXPECTED_PNPM" ]]; then
  echo "Expected pnpm $EXPECTED_PNPM (from package.json), found $ACTUAL_PNPM. Run: corepack prepare pnpm@$EXPECTED_PNPM --activate" >&2
  exit 1
fi

if ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  echo "Docker daemon is unavailable. Start the Codespaces Docker feature or Docker Desktop." >&2
  exit 1
fi
docker compose version >/dev/null
"${compose[@]}" config --quiet
echo "Toolchain OK: Node $(node --version), pnpm $ACTUAL_PNPM, Docker Compose available."

if [[ "$MODE" == "--database" || "$MODE" == "--services" ]]; then
  if ! "${compose[@]}" ps --status running --services | grep -qx postgres; then
    echo "PostgreSQL is not running. Start it with: ${compose[*]} up -d postgres" >&2
    exit 1
  fi
  if ! "${compose[@]}" exec -T postgres pg_isready -U questoria -d questoria >/dev/null 2>&1; then
    echo "PostgreSQL container is running but the questoria database is not ready." >&2
    exit 1
  fi
  echo "PostgreSQL OK: local Compose service accepts connections."
fi

if [[ "$MODE" == "--services" ]]; then
  require_command curl
  API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:4000}"
  WEB_BASE_URL="${WEB_BASE_URL:-http://127.0.0.1:3000}"

  curl --fail --silent --show-error --max-time 5 --output /dev/null "$API_BASE_URL/api/health"
  curl --fail --silent --show-error --max-time 5 --output /dev/null "$API_BASE_URL/api/health/ready"
  curl --fail --silent --show-error --max-time 10 --output /dev/null "$WEB_BASE_URL/"
  echo "Application OK: API liveness, API readiness and frontend respond."
fi
