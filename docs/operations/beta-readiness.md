# Questoria closed-beta readiness

This is an operational gate list, not evidence that production services are already provisioned. No production deployment, cloud account, domain, monitoring provider, file store, or production backup integration is configured by this repository.

## External dependencies and current state

| Area | Current implementation/state | Required before inviting beta users |
| --- | --- | --- |
| PostgreSQL | PostgreSQL 17 and migrations are available through local Docker Compose. Readiness runs `SELECT 1`. | Provision managed PostgreSQL, TLS, private network access, least-privilege credentials, automated backups and a tested restore/PITR procedure. |
| Email | API supports `EMAIL_PROVIDER=resend`; local development uses `console`. | Configure a Resend account, verify the sending domain, store `RESEND_API_KEY` securely, set `EMAIL_FROM`, and test verification/reset delivery and deliverability. |
| File/media storage | Upload/storage integration is not implemented. CMS can hold editorial cover metadata but cannot upload files. | Decide whether media is needed for the closed beta. If required, implement and security-review an object-storage integration, access policy, upload limits, and deletion lifecycle before enabling uploads. |
| Domain and HTTPS | No domain or hosting provider is supplied. Production environment validation requires HTTPS origins. | Choose canonical web origin, configure DNS and TLS certificates, set `WEB_ORIGIN` and `NEXT_PUBLIC_SITE_URL`, and verify secure cookies and email links behind the real proxy. |
| Secrets | Production API validates required environment variable shape at startup. | Put database, Resend and MFA keys in the hosting secret manager. Generate `MFA_ENCRYPTION_KEY` with `openssl rand -hex 32`; retain it securely and define a key-rotation/re-enrollment procedure. |
| Monitoring and alerting | Liveness/readiness endpoints and structured request-correlated API access logs exist. No monitoring or alerting provider is connected by this repository. | Connect uptime/metrics/log collection, alert on readiness failures, elevated 5xx/latency, email failures and backup freshness. Restrict log access and retention. |
| Backups | `scripts/db-backup.sh` and `scripts/db-restore.sh` intentionally support local Docker Compose only. | Enable provider-managed encrypted backups, off-site retention and PITR where supported. Run a restore drill into an isolated target and record RPO/RTO. |
| CI/CD | GitHub Actions runs validation on pushes to `main` and pull requests targeting `main`; it builds, tests, migrates/seeds a CI PostgreSQL instance, runs E2E smoke and verifies local backup/restore. | Keep required checks green and require review. No production deploy job is configured or implied. |
| Support/privacy | Product documentation identifies unfinished legal/privacy processes. | Approve privacy notice, terms, data-retention/deletion workflow, incident contact, support path and beta participant consent before launch. |

The current repository does not contain a production application Dockerfile/Compose stack or deployment-specific manifests. This change deliberately does not invent a hosting provider, credentials, bucket, DNS zone, or production image pipeline. Deploy the built web and API as separately managed processes/containers using a reviewed hosting design; keep PostgreSQL external and managed.

## Pre-beta release checklist

### Infrastructure and security

- [ ] Managed PostgreSQL is provisioned with TLS, network restrictions, tested credentials and migration permissions scoped to the release process.
- [ ] `NODE_ENV=production`, `DATABASE_URL`, `WEB_ORIGIN`, `NEXT_PUBLIC_SITE_URL`, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` and `MFA_ENCRYPTION_KEY` are present in the secret manager; no values are committed.
- [ ] The same-origin proxy/reverse-proxy forwards the expected host/protocol and preserves request IDs. Confirm secure session-cookie attributes on the HTTPS deployment.
- [ ] First Super Admin is provisioned only through the documented explicit bootstrap command after email verification. TOTP MFA is enabled and recovery codes are stored by the operator outside the application.
- [ ] Administrative RBAC, MFA enforcement, audit trail, account suspension and session-revocation behavior are verified against a production-like staging database.
- [ ] Secrets, database credentials, reset/verification links and session cookies are absent from application/access logs and incident reports.

### Data, recovery and operations

- [ ] Automated provider backups, encryption, retention, restricted access and PITR policy (if offered) are enabled.
- [ ] A restore drill has succeeded in a separate database/environment; integrity checks, app smoke test, RPO/RTO and operator steps are recorded.
- [ ] Liveness `GET /api/health` and readiness `GET /api/health/ready` are monitored separately. Readiness is the signal for whether PostgreSQL-backed traffic can be served.
- [ ] JSON access logs are collected with `X-Request-ID` correlation. Dashboards/alerts cover 5xx, latency, readiness, database saturation, email delivery and backup freshness.
- [ ] A rollback/forward-fix decision owner, deployment freeze procedure, graceful shutdown/restart procedure and incident communications path are documented.
- [ ] Capacity/rate limits, abuse monitoring, account recovery and support escalation have been reviewed for the expected beta cohort.

### Product and beta acceptance

- [ ] Frontend and API builds pass; migrations apply to a clean PostgreSQL instance; seed content is reviewed and does not overwrite editorial state.
- [ ] Registration, email verification, login, logout, password reset, cookie handling and cross-account access isolation pass.
- [ ] The complete demo quest passes all puzzle types; XP/coin ledger entries, repeat-completion idempotency, profile and progress match expected server-side values.
- [ ] Admin scenarios pass with MFA, least privilege, audit evidence and no public role-grant endpoint.
- [ ] Privacy notice, terms, data retention/deletion, participant consent and support instructions are approved.
- [ ] Beta owner signs off on known limitations, incident response, monitoring coverage and restore evidence.

## Operational signals

- `GET /api/health`: process liveness only.
- `GET /api/health/ready`: API plus PostgreSQL readiness; returns 503 when the database check fails.
- Every API response includes `X-Request-ID`; the API emits JSON access logs with request ID, method, route template, status and duration. Query strings, request bodies, cookies, Authorization headers and IP addresses are excluded from those access logs.
- A health endpoint is not a monitoring service. Configure an external monitor and alerts in the chosen hosting environment; do not describe them as active until tested.

## Release/incident sequence

1. Freeze feature changes and record the reviewed commit/artifact intended for the beta.
2. Take/verify a provider-managed pre-release backup and confirm restore permissions.
3. Apply Prisma migrations as a controlled one-off release step; do not edit already-applied migrations.
4. Start API and web processes, then verify readiness, email links on the real HTTPS domain, secure cookies, admin MFA and the full smoke flow.
5. Open beta traffic only after checks and owner sign-off. Monitor request IDs and readiness.
6. On incident, reduce/stop writes or isolate traffic, preserve logs and the current database for investigation. Prefer a forward-fix when post-backup user writes must be retained.
7. Restore only under an approved incident procedure after estimating data loss. The repository's local restore helper refuses remote databases and production mode; use the managed provider's verified recovery path for production.
8. Re-run health, authentication, quest, rewards, profile and admin smoke checks before reopening traffic.
