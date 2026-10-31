# LPHPV — the PHP image moves to its branch's newest security release (2026-10-31)

Lane LPHPV (ludion-ops#1, comment 6539200199 item 4, started by comment 6539943852 item (c)). Definitions fixed before the code: docs/decisions/2026-10-31-lphpv-php-security-release.md (commit 6bf87b2). Code, tests and these scripts at 2fb15af; the runs below are at 2fb15af with no file differing from it.

## What changed

- `packages/cli/src/security/php.ts`, `scanPhp`: the candidate is `fixes[0]`, the newest release of the branch tagged `security` that is newer than the Dockerfile's version (as `scanNode` in node.ts). Before, it was `releases[0]`, the branch's newest release, whenever a newer security release existed. Nothing else in the scan changes: `status`, `security_releases`, the source URL and its limits, the flavor kept.
- `packages/cli/test/fixtures/php-releases-8.4.json`: a sample shaped like php.net's `?json&version=8.4` response (made up, not fetched; no hashes), newest first: 8.4.30 and 8.4.29 with empty `tags` after the last security release 8.4.28, then 8.4.27 (empty), 8.4.26 (`security`), 8.4.25 (empty).
- `packages/cli/test/security.test.ts`: from 8.4.24, 8.4.25, 8.4.26 and 8.4.27 the candidate is `php:8.4.28-cli-alpine`, with `security_releases` and the exposure-time start (`phpFixPublished`) checked; from 8.4.28, 8.4.29 and 8.4.30 there is no candidate. The existing tests' sample (8.4.27 `security`, then 8.4.28 not) now expects 8.4.27 (the branch `ludion/php/8.4.27`, its Dockerfile, the receipt), where it expected 8.4.28.
- `packages/cli/test/node-image.test.ts`: the byte-order-mark case for `php:8.4.27-fpm` (sample: 8.4.28 `security`, 8.4.29 not) now expects 8.4.28, where it expected 8.4.29.
- README.md and packages/cli/README.md (one sentence), docs/status.md item 4 (one sentence).

## Runs (scripts/, logs/)

Every run in Docker, `--network none`, `--memory 4g`, image `ludion-l9-node24-git` (node v24.22.1), started from the host with `sh docs/bench/2026-10-31-lphpv/scripts/run.sh <name>`. `docker run --rm alpine free -m` before: available 13,711 MB.

| Run | What | Result |
|---|---|---|
| seed | node_modules copied from LNODE's volume ludion-lnode-w (its package-lock.json is byte-equal to this worktree's; no npm ci, no network), then the worktree into volume ludion-lphpv-w | seed exit 0 |
| full | `npm run build`, `npm run typecheck`, `npm test -- --maxWorkers=2` (every vitest project) | build exit 0; typecheck exit 0; `Test Files  39 passed (39)`, `Tests  1292 passed \| 24 skipped (1316)`; security.test.ts 50 tests, node-image.test.ts 55 tests (logs/full.log) |
| mutate | 6 mutations of scanPhp's choice (scripts/mutate.mjs), each against security.test.ts and node-image.test.ts | caught 6, survived 0, not applied 0; php.ts restored (logs/mutate.log) |

full.log's line `/w differs from /src in 1 entries` is full.log itself, which the host had created in /src before the container started (checked afterwards with the same diff: only logs/full.log and logs/mutate.log are in /src alone).

Mutations: P1 the behaviour before (the branch's newest release); P2 the smallest newer security release; P3 the newest newer release of any kind; P4 the `security` tag ignored; P5 the Dockerfile's own version counted as newer; P6 the flavor dropped from the tag.

## Not done here

- No end-to-end run against the real php.net and Docker Hub (the tests use the sample only). examples/php-security moved 8.4.26 → 8.4.27 in LNODE's e2e; whether real php.net now has a later release without `security` on that branch was not looked at.
- Gate 1, gate 2 and the waits for the image, as before.
