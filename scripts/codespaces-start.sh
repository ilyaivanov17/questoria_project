#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.yml}"
compose=(docker compose -f "$COMPOSE_FILE")
"${compose[@]}" up -d postgres

ready=0
for attempt in $(seq 1 45); do
  if "${compose[@]}" exec -T postgres pg_isready -U questoria -d questoria >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" -ne 1 ]]; then
  "${compose[@]}" logs --no-color --tail=80 postgres >&2 || true
  echo "PostgreSQL did not become ready after the Codespace started." >&2
  exit 1
fi

bash scripts/check-environment.sh --database
