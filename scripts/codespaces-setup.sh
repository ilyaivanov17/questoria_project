#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

EXPECTED_NODE_MAJOR=22
node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major !== 22 || minor < 12) {
    console.error("Questoria requires Node.js >=22.12 and <23; found " + process.versions.node);
    process.exit(1);
  }
'

EXPECTED_PNPM="$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '')")"
# The devcontainer connects as the unprivileged `node` user. Corepack's
# pnpm shim is installed into /usr/local/bin, so create it with sudo once.
if [[ "$(id -u)" -eq 0 ]]; then
  corepack enable
elif command -v sudo >/dev/null 2>&1; then
  sudo corepack enable
else
  echo "Corepack shim setup needs root or sudo access." >&2
  exit 1
fi
corepack prepare "pnpm@$EXPECTED_PNPM" --activate

umask 077
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created a local .env from .env.example."
else
  echo "Existing .env detected; leaving it unchanged."
fi

bash scripts/check-environment.sh --tools

if [[ -f pnpm-lock.yaml ]]; then
  pnpm install --frozen-lockfile
else
  echo "pnpm-lock.yaml is not committed yet; generating a local lockfile during install."
  pnpm install --no-frozen-lockfile
fi

# Refuse to migrate or seed anything except the documented local Compose database.
node --input-type=module <<'NODE'
import { config } from 'dotenv';

config();
const value = process.env.DATABASE_URL;
let url;

try {
  url = new URL(value ?? '');
} catch {
  console.error('DATABASE_URL is missing or invalid; setup stopped before touching PostgreSQL.');
  process.exit(1);
}

const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
const user = decodeURIComponent(url.username);
if (
  !['postgres:', 'postgresql:'].includes(url.protocol) ||
  !allowedHosts.has(url.hostname) ||
  (url.port || '5432') !== '5432' ||
  database !== 'questoria' ||
  user !== 'questoria'
) {
  console.error('Codespaces setup only operates on localhost:5432 database "questoria" as user "questoria". No migrations or seed were run.');
  process.exit(1);
}
NODE

COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.yml}"
compose=(docker compose -f "$COMPOSE_FILE")
"${compose[@]}" up -d postgres

ready=0
for attempt in $(seq 1 60); do
  if "${compose[@]}" exec -T postgres pg_isready -U questoria -d questoria >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" -ne 1 ]]; then
  "${compose[@]}" logs --no-color --tail=80 postgres >&2 || true
  echo "PostgreSQL did not become ready within 60 seconds." >&2
  exit 1
fi

pnpm db:generate
pnpm db:deploy
pnpm db:seed
bash scripts/check-environment.sh --database

cat <<'MESSAGE'

Questoria Codespaces setup is complete.

  Start web + API:  pnpm dev
  Check tools/DB:   bash scripts/check-environment.sh --database
  Check all apps:   bash scripts/check-environment.sh --services

Open the forwarded port 3000. The API stays on localhost:4000 inside the Codespace;
the frontend's same-origin proxy handles browser requests.
MESSAGE
