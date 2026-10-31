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

## The hand check through both jobs (LIMGV-CHK, procedure fixed before the run)

Brief: claude-task-2026-10-31-limgv-chk.md (brain 6542129458, item 2). main d200350 (#240) was merged in first (991d209, no conflict, package-lock.json unchanged); `scripts/run.sh full` there: build exit 0, typecheck exit 0, `Test Files  40 passed (40)`, `Tests  1380 passed | 25 skipped (1405)` (logs/full-3.log).

What runs: scripts/e2e.sh, unchanged, at the head that holds this section, with the cases `node php node-newest node-missing`, in one container started from the host with:

```sh
MSYS_NO_PATHCONV=1 docker run --rm --memory 4g -v C:/dev/ludion-limgv:/src:ro \
  -v C:/dev/ludion-limgv/docs/bench/2026-10-31-limgv/scripts:/scripts:ro \
  -v C:/dev/ludion-limgv/docs/bench/2026-10-31-lnode/scripts:/lnode:ro \
  -v ludion-limgv-e2e-w:/w -v ludion-limgv-e2e:/e -v /var/run/docker.sock:/var/run/docker.sock \
  -e NEWEST_FROM=24.22.1-alpine -e MISSING_FROM=22.22.0-alpine3.22 \
  ludion-la-runner sh /scripts/e2e.sh node php node-newest node-missing > docs/bench/2026-10-31-limgv/logs/e2e.log 2>&1
```

- Image ludion-la-runner (node 24, git, the Docker CLI on the host's socket), network on (nodejs.org, php.net, Docker Hub, the npm registry for `npm ci`), `--memory 4g`. The two volumes are new and are removed after the run, with ludion-limgv-w.
- Both jobs, twice per case: the validation job (`ludion patch --dir <fresh clone> --apply --json`, then `ludion deliver pack`) and the PR job (`ludion deliver open`, which calls `openFixes`). GitHub's API is LNODE's stand-in scripts/github.mjs on 127.0.0.1 (a fake receiver; no PR is opened on GitHub and no real repository is touched); the push goes to a bare repository in the volume. So the check reaches the PR's title, body and branch as the stand-in receives them, not a PR on GitHub.
- Inputs, read before the run (2026-10-31 ~13:55Z, in a container, from nodejs.org's index.json and Docker Hub's tag list; `docker manifest inspect` on the host for the last two): line 24's newest release 24.22.2 (2026-10-27, `security: false`), its newest security release 24.22.1 (2026-10-20, `security: true`); line 22's newest 22.23.4 (2026-10-20, `security: true`). `node:22.22.0-alpine3.22` exists; `node:22.23.4-alpine3.22` does not (`no such manifest`).

The three points of the brief and what passes each (judged from the raw log, logs/e2e.log):

1. The move to the newest release with no security release reaches the PR (case `node-newest`, FROM node:24.22.1-alpine): run 1's `patch` exits 0 with outcome `applied` and `node 24.22.1 -> 24.22.2`, `pack` and `open` exit 0, the stand-in has one open PR from a `ludion/` branch whose Dockerfile is `FROM node:24.22.2-alpine@sha256:…`; run 2 opens no second PR.
2. No "security" in the PR's text (same case): the script's line `"security" in title or body: false` for that PR.
3. A missing tag stops with its reason (case `node-missing`, FROM node:22.22.0-alpine3.22): in both runs `patch` exits non-zero with no applied receipt, its reason (stderr or the JSON's scan) begins `Docker Hub has no node:22.23.4-alpine3.22`, `pack` produces no fixes.bundle, no `ludion/` branch is pushed and the stand-in has no PR.

The cases `node` and `php` (the examples as they are) are run too, as LNODE's were; they are not among the three points.

### As planned before LIMGV-CHK (the earlier text)

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
