# GitHub Codespaces runbook

## First start

1. Open the repository in GitHub and choose **Code → Codespaces → Create codespace on main**.
2. The checked-in `.devcontainer/devcontainer.json` selects the Node.js 22 image and the Docker-in-Docker feature. The post-create task prepares the pinned pnpm version, creates a local `.env` only when it is absent, installs workspace dependencies, starts PostgreSQL, applies migrations and seeds the demo quest.
3. Wait for the post-create task to finish. The forwarded browser port is **3000**. The API listens on **localhost:4000 inside the Codespace** and must not be exposed as a public browser endpoint.
4. Start the application:

   ```bash
   pnpm dev
   ```

5. Open the forwarded Questoria web port. To verify the local API and database directly from the terminal:

   ```bash
   curl -fsS http://localhost:4000/api/health
   curl -fsS http://localhost:4000/api/health/ready
   bash scripts/check-environment.sh --services
   ```

The frontend uses the repository's same-origin API proxy. Keep `API_INTERNAL_URL=http://localhost:4000` and leave `WEB_ORIGIN` and `NEXT_PUBLIC_SITE_URL` empty in Codespaces unless a local test explicitly needs another value. Do not paste a Codespaces forwarded URL into `.env`.

## Safe setup and repeatability

Run `bash scripts/codespaces-setup.sh` to repeat initial setup after a failed create. It is safe to re-run against the documented local database: it does not overwrite an existing `.env`, installs the committed workspace lockfile in frozen mode, and verifies that `DATABASE_URL` targets only the local `questoria` database on port 5432 before running migrations or seed.

`pnpm-lock.yaml` is committed at the repository root and resolves the root workspace, API, web app and contracts package. Dependency updates must change the relevant manifest and lockfile together. Infrastructure CI checks `pnpm install --frozen-lockfile`; do not regenerate or commit a lockfile from an unreviewed dependency state.

When a stopped Codespace starts again, `postStartCommand` starts the existing PostgreSQL Compose service and checks readiness. It does not reinstall dependencies, migrate, reseed or delete data. After pulling backend changes that add migrations, use:

```bash
pnpm db:deploy
pnpm db:seed
```

The seed script preserves an already-published demo version and refuses to overwrite unexpected editorial workflow states.

## Toolchain and service checks

```bash
bash scripts/check-environment.sh            # Node, pnpm, Docker daemon and Compose config
bash scripts/check-environment.sh --database # plus local PostgreSQL readiness
bash scripts/check-environment.sh --services # plus API liveness/readiness and frontend HTTP
```

Expected versions come from the repository toolchain: Node.js 22 (at least 22.12, below 23) and pnpm 12.17.0. The bootstrap uses Corepack to activate the exact pnpm version declared in the root `package.json`.

## Manual checks and automated smoke test

For normal interactive development, `pnpm dev` starts both the web and API workspace applications. Run the static/unit/build checks with:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

The full API smoke script expects a built API and a dedicated API log file because it reads local `EMAIL_PROVIDER=console` verification/reset links from that file. Use a disposable local database only:

```bash
pnpm --filter @questoria/api start > /tmp/questoria-api.log 2>&1 &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT
API_LOG_FILE=/tmp/questoria-api.log node scripts/smoke.mjs
```

The smoke script creates temporary accounts, verifies email and reset flows, completes the seeded quest, and bootstraps an administrator for MFA/session checks. Do not point it at production, a shared user database, or any database containing real accounts. The console email log contains one-time action URLs; keep it local and never attach or publish it.

## Database lifecycle and troubleshooting

```bash
docker compose -f infra/docker/docker-compose.yml ps
docker compose -f infra/docker/docker-compose.yml logs --tail=100 postgres
docker compose -f infra/docker/docker-compose.yml restart postgres
bash scripts/codespaces-start.sh
```

Stop the app with **Ctrl+C** in the terminal running `pnpm dev`. To stop only PostgreSQL while preserving its named volume:

```bash
docker compose -f infra/docker/docker-compose.yml stop postgres
```

A later `bash scripts/codespaces-start.sh` starts it again. Do not use `docker compose down --volumes`, `docker volume prune`, or Codespaces rebuilds that delete persistent data unless the owner explicitly approved data removal.

Typical diagnosis:

- **Docker daemon unavailable:** wait for the Docker-in-Docker feature, then run `docker version`. Do not install another daemon inside the Codespace.
- **PostgreSQL not ready:** inspect `docker compose ... logs postgres`, then run `bash scripts/codespaces-start.sh`. The named volume is preserved.
- **Prisma cannot connect:** check that `.env` exists and `DATABASE_URL` uses `localhost:5432/questoria`; never print the full URL because it includes credentials.
- **Browser API calls fail:** use the forwarded port 3000 and the same-origin proxy. Do not configure the browser to call `localhost:4000` from the user's machine.
- **Email links are missing:** confirm `EMAIL_PROVIDER=console`, start the API from the repository root, and inspect its local terminal/log. Do not share those logs.

## Backups

Local PostgreSQL backup and restore instructions are in [postgres-backup-restore.md](postgres-backup-restore.md). The restore helper is destructive by design and requires both `ALLOW_DATABASE_RESTORE=1` and an exact database-name confirmation. Prefer the CI pattern of restoring into a separate empty database. Never test restore against shared or production data.
