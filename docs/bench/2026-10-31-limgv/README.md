# LIMGV — an official PHP or Node.js image moves to the newest release of its line that Docker still builds (2026-10-31)

Lane LIMGV, from main 355a91c (PR #239; #238, the first attempt, was closed unmerged). Definitions fixed before the code: docs/decisions/2026-10-31-limgv-image-newest-built-release.md (commit dc21a94). Code 86d245c, tests f991480, docs 795e97b.

## Runs (scripts/, logs/)

Every run in Docker, started from the host with `sh docs/bench/2026-10-31-limgv/scripts/run.sh <name>`: image ludion-l9-node24-git, `--network none`, `--memory 4g`, the worktree read-only at /src, the volume ludion-limgv-w at /w (its node_modules copied from ludion-lphpv2-w; package-lock.json is the same at 9c4de68 and 355a91c). No node, npm or vitest ran on the host for these runs.

| Run | How | Result |
|---|---|---|
| full | `npm run build`, `npm run typecheck`, `npm test -- --maxWorkers=2` | build exit 0, typecheck exit 0, `Test Files  40 passed (40)`, `Tests  1369 passed \| 25 skipped (1394)` (logs/full-1.log, code and tests as at 795e97b) |
| mutate | 25 mutations (scripts/mutate.mjs), each alone, then `npx vitest run --project node --maxWorkers=2`; as a named container without a tmpfs /tmp | `caught 25, survived 0, not applied 0, void 0`; every mutated file restored (logs/mutate.log) |
| full (final) | as full, at the head with this folder and the progress record | logs/full-2.log |

The mutations put back what the decision removes, one at a time: the newest security release as the candidate (M1); stopping a move with no newer security release (M2); no wait, a wait of 72 hours from the start of the day, a wait for a security move too (M3–M5); no Docker Hub check, a 404 read as present (M6, M7); no stop on a missing list (M8); php.net's and nodejs.org's order trusted (M9, M10, R237's R5); string comparisons (M11, R237's R10; M12); an unreadable day giving "no update" (M13); the move counted in exposure time (M14, M15); `patch` working during the wait (M16); "security releases" in the commit (M17); the PR job requiring a security release, not checking the wait or `fix_published_at`, not marking the move (M18–M21); the PR body's opening, Advisories, Fix published and judge lines back to a security fix's (M22–M25).

## The hand check through both jobs (not run by this lane)

As LNODE's (docs/bench/2026-10-31-lnode, its run `e2e`), with scripts/e2e.sh, which uses LNODE's github.mjs (the stand-in for GitHub's API) and summary.mjs. It needs the network, Docker on the host's socket and the image ludion-la-runner:

```sh
MSYS_NO_PATHCONV=1 docker run --rm --memory 4g -v C:/dev/ludion-limgv:/src:ro \
  -v C:/dev/ludion-limgv/docs/bench/2026-10-31-limgv/scripts:/scripts:ro \
  -v C:/dev/ludion-limgv/docs/bench/2026-10-31-lnode/scripts:/lnode:ro \
  -v ludion-limgv-e2e-w:/w -v ludion-limgv-e2e:/e -v /var/run/docker.sock:/var/run/docker.sock \
  -e NEWEST_FROM=24.22.1-alpine -e MISSING_FROM=<old-release>-<variant> \
  ludion-la-runner sh /scripts/e2e.sh node php node-newest node-missing
```

What each case should show (expectations, not results):

- `node`, `php`: examples/node-security (node:22.22.0-alpine) and examples/php-security (php:8.4.26-cli-alpine) move to the newest release of their line, with the security releases between in the commit; run 1 opens one PR, run 2 none (`open_pr_exists`).
- `node-newest`: `FROM node:24.22.1-alpine`. On 2026-10-31, nodejs.org's index has 24.22.1 (2026-10-20, security) and 24.22.2 (2026-10-27, not), so the move to 24.22.2 has no newer security release and a `wait_until` of 2026-10-31T00:00:00.000Z, already passed. Run 1: `security_releases` empty, `fix_published_at` null, the commit paragraph `Node.js 24.22.2, the newest release of the line (no newer security release); Docker rebuilds only the newest tag of a line.`, one PR whose title and body do not contain "security" (the script prints that check). Run 2: no second PR.
- `node-missing`: choose first a variant whose tag exists for an older release and not for the line's newest (`docker manifest inspect node:<newest>-<variant>` fails). `patch` should stop with `Docker Hub has no node:<newest>-<variant>, ...`, and nothing is packed or opened.

## Not done here

The hand check above. A run on GitHub. LDGLAT, LDG, moving a variant's OS release, the CLAUDE.md sentence (LC0a), LR3 and decision 4, and the "OS layer age" number.
