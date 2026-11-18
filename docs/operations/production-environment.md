# Production API environment

The API validates its production environment before creating the NestJS application. When NODE_ENV=production, startup stops with a list of configuration errors if required values are missing or unsafe. Development, test, and Codespaces behavior is unchanged.

## Required settings

| Variable | Production requirement |
| --- | --- |
| NODE_ENV | Set to production. |
| DATABASE_URL | Valid postgres:// or postgresql:// URL with username, password, and a non-loopback database hostname. Configure TLS according to the managed PostgreSQL provider. |
| API_INTERNAL_URL | Internal API origin reachable from the Next.js server runtime. Set it explicitly when web and API run in separate network namespaces; do not expose it as a browser URL. |
| WEB_ORIGIN | HTTPS origin only, for example https://questoria.example.com; no path, query, or fragment. Used for API CORS. |
| NEXT_PUBLIC_SITE_URL | HTTPS origin only. Used to build email verification and password-reset links. |
| EMAIL_PROVIDER | Explicitly set to resend. The console provider is development-only. |
| RESEND_API_KEY | Non-empty Resend API key stored in the deployment secret manager. |
| EMAIL_FROM | Valid sender address, optionally with a display name, e.g. Questoria <no-reply@questoria.example.com>. Verify the sender domain in Resend before launch. |
| MFA_ENCRYPTION_KEY | Exactly 32 random bytes encoded as 64 hexadecimal characters. Required for TOTP administrator MFA. |

Generate the MFA encryption key in a trusted environment with: openssl rand -hex 32.

Store all credentials in the hosting provider's secret manager. Never commit real values, paste them into issues, or reuse the local-development credentials from .env.example.

Treat a change to MFA_ENCRYPTION_KEY as a key-rotation event: existing encrypted TOTP secrets cannot be decrypted with a different key, so plan an explicit administrator MFA re-enrollment before rotating it.



## Provider-neutral production containers

The repository provides one Dockerfile with three explicit targets:

- `api`: non-root Node.js runtime for NestJS. Port 4000 is exposed only to the Compose network.
- `web`: non-root Next.js runtime. Its API rewrite is built with the internal service address `http://api:4000`.
- `migrate`: a one-shot migration image containing the Prisma CLI. It is not started as part of the normal application `up`.

The production Compose overlay is `infra/docker/docker-compose.production.yml`. It deliberately has **no PostgreSQL service**: set `DATABASE_URL` to the separately provisioned managed database. The web port is bound to loopback by default so an external HTTPS reverse proxy can terminate TLS. The API is not published on a host port.

Build and validate image targets in CI. For an operator-run deployment, supply these runtime values from the hosting secret manager or an environment file outside the repository (never commit it):

- `DATABASE_URL`
- `WEB_ORIGIN`
- `NEXT_PUBLIC_SITE_URL`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `MFA_ENCRYPTION_KEY`

Example operator sequence with a protected environment file:

```bash
COMPOSE="docker compose --env-file /secure/path/questoria.production.env -f infra/docker/docker-compose.production.yml"

# Apply schema changes as an explicit, reviewed release step.
$COMPOSE --profile release run --rm migrate

# Build and start the application containers.
$COMPOSE up -d --build
$COMPOSE ps
```

Configure DNS, HTTPS certificates, HSTS, forwarded headers and the reverse proxy separately. Route the public hostname to `127.0.0.1:3000`; do not publish the API port. The Compose file uses internal service networking for API requests. For a remote image registry, set `QUESTORIA_API_IMAGE` and `QUESTORIA_WEB_IMAGE`, build/push the corresponding targets in your release pipeline, and deploy immutable image tags.

The migration command is intentionally separate from `up`. The image contains no real connection string, email key or MFA secret; build-time `DATABASE_URL` is a non-routable placeholder used only by Prisma client generation. This Compose overlay is a deployment recipe, not a deployment: it does not provision a cloud account, database, reverse proxy, domain, certificate, secret manager, monitoring provider or backup policy.

## Deployment checklist

1. Provision managed PostgreSQL and use its externally reachable connection hostname.
2. Enable the provider's TLS settings for database connections and restrict database network access.
3. Set the two HTTPS origins to the deployed frontend's canonical origin.
4. Set API_INTERNAL_URL to the API origin as reachable from the Next.js server runtime; keep this server-side value private.
5. Configure Resend, verify the sender domain, and set the API key and sender address.
6. Generate and securely store the MFA encryption key.
7. Start the API and confirm GET /api/health/ready succeeds after database migrations are applied.
8. Send verification and password-reset emails to test accounts and confirm their links use the deployed HTTPS domain.
9. Verify an administrator can enroll in TOTP MFA and complete an authenticated admin action.

The startup check validates configuration shape only. It cannot prove that credentials are valid, that a Resend sender is verified, or that the database is reachable. Readiness checks database connectivity; the email and MFA checks above must be completed in the target environment before inviting beta users.
