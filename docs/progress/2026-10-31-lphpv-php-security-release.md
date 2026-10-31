# 2026-10-31 — LPHPV: the PHP image moves to its branch's newest security release, as Node.js's does

Lane LPHPV. Definitions: docs/decisions/2026-10-31-lphpv-php-security-release.md. Detail, scripts and logs: docs/bench/2026-10-31-lphpv.

- `scanPhp` now takes the newest release of the Dockerfile's branch that php.net tags `security` and that is newer than the Dockerfile's version; a later release without that tag is no longer taken. Example (the tests' sample): on `php:8.4.25-cli-alpine`, with 8.4.27 tagged `security` and 8.4.28 not, the candidate is 8.4.27, where it was 8.4.28. Nothing else changes: when an update is found, `security_releases`, `fix_published_at`, the branch, commit, receipt, digest pinning, the PR job's checks, the gates and the waits.
- Tests (in Docker, no network), at 2fb15afb6c92ac592e897afe1be05b5ddede2583: `npm run build` exit 0, `npm run typecheck` exit 0, `npm test -- --maxWorkers=2` `Test Files  39 passed (39)`, `Tests  1292 passed | 24 skipped (1316)`. Mutations of the choice: 6 of 6 caught, 0 not applied.
- Not done: an end-to-end run against the real php.net and Docker Hub; gate 1, gate 2 and the waits for the image (as before).
