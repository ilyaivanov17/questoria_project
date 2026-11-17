# PostgreSQL backup and restore runbook

## Scope and safety

The repository scripts below support the **local Docker Compose PostgreSQL service only**. They require Docker Compose and a root `DATABASE_URL` pointing to `localhost:5432` (or `127.0.0.1:5432`) and a user matching the Compose service's `POSTGRES_USER`.

They are not a production backup system. They do not provide off-site retention, encryption at rest, point-in-time recovery (WAL archiving), cluster-wide role backups, or monitoring of backup freshness. Before a public beta, configure provider-managed automated backups/snapshots, point-in-time recovery where available, a retention policy, restricted access, and a documented restore drill for the hosted database. Do not copy production data into developer environments.

## Create and verify a backup

Start the local database and keep the app/API in a state appropriate for a consistent logical snapshot:

```bash
docker compose -f infra/docker/docker-compose.yml up -d postgres
pnpm run db:backup -- backups/questoria-before-change.dump
```

The command writes a PostgreSQL custom-format archive and a sibling `.sha256` file. The archive is checked with `pg_restore --list` before it is reported as complete. Backups are created with restrictive file permissions and the `backups/` directory is excluded from Git.

Keep a separate copy of both files in a protected location. A checksum detects accidental corruption; it does not prove who created the backup or encrypt its contents.

## Restore into a local database

**Restore replaces schema objects present in the archive. Stop the web/API processes and make a fresh backup before restoring. Confirm the target name carefully.**

```bash
ALLOW_DATABASE_RESTORE=1 pnpm run db:restore -- backups/questoria-before-change.dump --confirm-database questoria
```

The restore command checks the sidecar checksum, verifies the archive, requires the explicit `ALLOW_DATABASE_RESTORE=1` gate and an exact database-name match, then runs `pg_restore --clean --if-exists` in one transaction. It refuses PostgreSQL system databases and refuses to run with `NODE_ENV=production`.

## Test recovery without touching the working database

The CI pipeline creates a second empty database, restores the backup there, and compares the row counts for `quests`, `categories`, and completed Prisma migration records with the source database. The temporary database is removed even when a later CI step fails.

You can perform the same exercise locally:

```bash
docker compose -f infra/docker/docker-compose.yml exec -T postgres createdb -U questoria questoria_restore_check
ALLOW_DATABASE_RESTORE=1 DATABASE_URL="postgresql://questoria:questoria_local_only@localhost:5432/questoria_restore_check?schema=public" pnpm run db:restore -- backups/questoria-before-change.dump --confirm-database questoria_restore_check
docker compose -f infra/docker/docker-compose.yml exec -T postgres psql -U questoria -d questoria_restore_check -c "SELECT COUNT(*) FROM quests"
docker compose -f infra/docker/docker-compose.yml exec -T postgres dropdb -U questoria --if-exists questoria_restore_check
```

## Schema rollback policy

Prisma Migrate is treated as forward-only: do not edit a migration that has already been applied and do not assume that a SQL migration can be reversed safely. Prefer a new corrective migration (forward-fix).

For a failed release, stop writes, preserve the current database for investigation, and decide whether restoring the pre-release backup is acceptable. Restoring loses all writes made after that backup. If new user data must be retained, use a reviewed forward-fix or a data-repair procedure instead. Restore the matching application release and run the smoke checks before reopening traffic.

For a hosted production database, use the provider's tested restore/PITR workflow and an approved incident procedure. The local helper intentionally cannot connect to a remote/production database.
