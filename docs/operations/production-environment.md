# Production API environment

The API validates its production environment before creating the NestJS application. When NODE_ENV=production, startup stops with a list of configuration errors if required values are missing or unsafe. Development, test, and Codespaces behavior is unchanged.

## Required settings

| Variable | Production requirement |
| --- | --- |
| NODE_ENV | Set to production. |
| DATABASE_URL | Valid postgres:// or postgresql:// URL with username, password, and a non-loopback database hostname. Configure TLS according to the managed PostgreSQL provider. |
| WEB_ORIGIN | HTTPS origin only, for example https://questoria.example.com; no path, query, or fragment. Used for API CORS. |
| NEXT_PUBLIC_SITE_URL | HTTPS origin only. Used to build email verification and password-reset links. |
| EMAIL_PROVIDER | Explicitly set to resend. The console provider is development-only. |
| RESEND_API_KEY | Non-empty Resend API key stored in the deployment secret manager. |
| EMAIL_FROM | Valid sender address, optionally with a display name, e.g. Questoria <no-reply@questoria.example.com>. Verify the sender domain in Resend before launch. |
| MFA_ENCRYPTION_KEY | Exactly 32 random bytes encoded as 64 hexadecimal characters. Required for TOTP administrator MFA. |

Generate the MFA encryption key in a trusted environment with: openssl rand -hex 32.

Store all credentials in the hosting provider's secret manager. Never commit real values, paste them into issues, or reuse the local-development credentials from .env.example.

Treat a change to MFA_ENCRYPTION_KEY as a key-rotation event: existing encrypted TOTP secrets cannot be decrypted with a different key, so plan an explicit administrator MFA re-enrollment before rotating it.

## Deployment checklist

1. Provision managed PostgreSQL and use its externally reachable connection hostname.
2. Enable the provider's TLS settings for database connections and restrict database network access.
3. Set the two HTTPS origins to the deployed frontend's canonical origin.
4. Configure Resend, verify the sender domain, and set the API key and sender address.
5. Generate and securely store the MFA encryption key.
6. Start the API and confirm GET /api/health/ready succeeds after database migrations are applied.
7. Send verification and password-reset emails to test accounts and confirm their links use the deployed HTTPS domain.
8. Verify an administrator can enroll in TOTP MFA and complete an authenticated admin action.

The startup check validates configuration shape only. It cannot prove that credentials are valid, that a Resend sender is verified, or that the database is reachable. Readiness checks database connectivity; the email and MFA checks above must be completed in the target environment before inviting beta users.
