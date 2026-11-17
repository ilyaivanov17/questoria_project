# Security policy

## Supported versions

Only the latest code on the default branch is actively maintained. Older commits and unreleased feature branches may contain known vulnerabilities and do not receive security fixes.

## Reporting a vulnerability

Please do not report suspected vulnerabilities in public GitHub issues, discussions, or pull requests.

Use GitHub's **Report a vulnerability** action in the repository's Security tab to send a private vulnerability report. If private vulnerability reporting is unavailable, contact the repository maintainers privately through GitHub before sharing technical details publicly.

Include, where possible:
- affected commit, version, component, and deployment context;
- concise reproduction steps and the security impact;
- any proof of concept that does not access real user data or disrupt service;
- a suggested mitigation, if known.

Please allow maintainers reasonable time to investigate, validate, and prepare a fix before public disclosure. Do not access, modify, or retain data belonging to other users while investigating.

## Operational notes

- Never commit .env files, API keys, database credentials, MFA encryption keys, session cookies, or database backups.
- Rotate any credential that may have been exposed; removing it from the latest commit does not remove it from Git history.
- Production deployments must use HTTPS, a verified email sender, restricted database access, managed encrypted backups, and a tested recovery procedure.
- Local backup/restore scripts in this repository are intentionally restricted to Docker Compose on localhost and are not a substitute for managed production backups.
