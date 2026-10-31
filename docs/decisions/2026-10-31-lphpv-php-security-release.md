# 2026-10-31 — The official PHP image moves to its branch's newest security release, as Node.js's does (LPHPV)

**Lane LPHPV**, asked by the coordinator's brief (ludion-ops#1, comment 6539200199, item 4, started by comment 6539943852, item (c)). Written and committed before the code, as the lane rules require.

## Why

The Goal is the smallest fixed version. Until now `scanPhp` (packages/cli/src/security/php.ts) took the newest release of the Dockerfile's branch whenever a newer security release existed, so a release with no security fix, published after the last security release, was taken too. Node.js's image takes the newest security release of its line and nothing after it (docs/decisions/2026-10-31-lnode-node-image.md, item 5, which recorded that PHP's choice was not changed there). PHP now does the same:

- Fewer changes that the fix does not need reach the project, so less can break (gate 3).
- In a quiet repository the candidate changes only when a security release is published, not when a bug-fix release follows one.

## Decided

1. **The version taken.** Among the releases of the Dockerfile's branch (the same `X.Y`) that php.net's JSON tags `security` and that are newer than the Dockerfile's version, the newest. A branch's releases are cumulative, so that is the smallest version that holds every security fix the branch has published. A later release whose `tags` has no `security` is not taken. Example: on `php:8.4.25-cli-alpine`, with 8.4.27 tagged `security` and a later 8.4.28 not, the candidate is `php:8.4.27-cli-alpine`, where it was 8.4.28.
2. **Unchanged.** When an update is found (a newer release tagged `security`), when none is (`no_newer_security_release`), the branch and the flavor kept, the source (`https://www.php.net/releases/index.php?json&version=<branch>&max=100`) and its limits, what makes the lookup fail, `security_releases` (every release tagged `security` newer than the Dockerfile's version, newest first), `fix_published_at` (the day of the first of them), the branch name, commit message, receipt, digest pinning, the PR job's checks, the gates and their number, the wait table, and the scope. Only which of the branch's releases becomes the candidate changes.
3. **Tests.** A sample shaped like php.net's JSON, kept with the tests (no network in the tests), with releases whose `tags` has no `security` after the last security release: the candidate is that security release, never the later ones, from every version below it; from the security release itself or above it there is no candidate.

## Not covered

As before for PHP: gate 1's matching to the project's OS, SAPI or configuration; gate 2's checks and the waits; same-tag rebuilds; end-of-life branches; minor or major upgrades.

## Undo

A later record.
