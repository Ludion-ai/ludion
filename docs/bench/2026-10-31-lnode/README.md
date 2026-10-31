# LNODE — the official Node.js image, same release line (2026-10-31)

Lane LNODE (docs/status.md, Missing item 4). Definitions fixed before the code: docs/decisions/2026-10-31-lnode-node-image.md (commit f4bba93). Code at 9b1dd96; the runs below are at ba04725 (9b1dd96 plus this folder's test.sh), with no file differing from it.

## What was built

- `packages/cli/src/security/node.ts`: reads the Dockerfile's one `FROM node:X.Y.Z[-variant]`, reads nodejs.org/dist/index.json, and takes the newest release of the same major marked `security: true` that is newer than the image.
- `php.ts`: PHP's Dockerfile checks and its release download, shared (`officialImage`, `releaseJson`); PHP's behaviour and messages are unchanged.
- `patch.ts`: a policy with `"ecosystem": "node"` runs PHP's path for `node` (pull by tag, the `node@sha256:` digest, build offline, the built image's `node -e` version check, the project's test on old and new, one commit on `ludion/node/<version>`). `exposure.ts`: `fix_published_at` from the index's day.
- `project.ts`, `cli.ts`, `scan.ts`: the `node` policy; `init` and `scan` offer it for a `FROM node:` line.
- `deliver.ts` (the scheduled workflow's PR job): the `node` policy at the base, the receipt's `scan.runtime`, the branch and message, the Dockerfile's FROM change to `node:<version><variant>@sha256:`, and Docker Hub's digest for `library/node`. A policy with a Dockerfile and another ecosystem is refused.
- `action/patch.sh`: the job summary names the image receipt's runtime.
- `examples/node-security`: `FROM node:22.22.0-alpine` and a smoke test, as examples/php-security.

## Runs (scripts/, logs/)

Every run in Docker, started from the host with `sh docs/bench/2026-10-31-lnode/scripts/run.sh <name>`; `docker run --rm alpine free -m` was checked before each (available 13,998 MB to 14,783 MB; limit 4 GB × 1.25 = 5,120 MB).

| Run | How | Result (logs/) |
|---|---|---|
| ci | `--memory 4g`, network on: the worktree into volume ludion-lnode-w, `npm ci --ignore-scripts` | exit 0 |
| test | `--memory 4g --network none`: `npx tsc -p tsconfig.json`, `npx vitest run --project node --maxWorkers=2` (every file of the node project) | tsc exit 0; 36 files passed; 1,230 passed, 19 skipped (test.log) |
| mutate | `--network none`: 26 mutations of the new code, each against node-image, deliver and security tests | 26 of 26 caught, 0 survived, 0 not applied; every file restored (mutate.log) |
| e2e | ludion-la-runner (node 24, git, Docker CLI on the host's socket), network on: both jobs of the scheduled workflow, twice per case, on copies of examples/node-security and examples/php-security, against the real nodejs.org, php.net, Docker Hub and Docker; GitHub's API is scripts/github.mjs | both cases: run 1 opened one PR, run 2 opened none (open_pr_exists) (e2e.log) |

e2e, the Node.js case: `node 22.22.0 -> 22.23.4`, outcome `applied`, security releases newer than 22.22.0 read from the index `22.23.4, 22.23.2, 22.23.0, 22.22.2`, old digest `node@sha256:e4bf2a82ad0a4037d28035ae71529873c069b13eb0455466ae0bc13363826e34`, new `node@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914` (the same as Docker Hub's `docker-content-digest` for `node:22.23.4-alpine`, read by hand with curl before the run), the branch's Dockerfile `FROM node:22.23.4-alpine@sha256:fe4f6d74…`, `fix_published_at` 2026-03-24T00:00:00.000Z (22.22.2's day, the first security release newer than 22.22.0). The PHP case still moves 8.4.26 → 8.4.27 as before.

The index on 2026-10-31 (read with curl, 336,201 bytes, 144 entries marked `security: true` of 878): line 24's newest release, 24.22.2 (2026-10-27), is not marked; its newest security release is 24.22.1 (2026-10-20). So a project on line 24 below 24.22.1 moves to 24.22.1, not 24.22.2.

## Not done here

- No run on GitHub (the e2e's GitHub is a stand-in). No run on the workflow's schedule.
- No gate 1 (whether a release's fixes reach the project), gate 2 or wait for the image, as for PHP.
- The site (apps/site) does not mention the Node.js image and still says runtime upgrades beyond PHP are not supported (docs/status.md, item 6).
- The mutations cover the new code; `action/patch.sh`'s summary line has no test.

## Scripts

Copied from docs/bench/2026-10-30-lb-design and changed: `sync.sh` (as is), `e2e.sh` (a `node` case through examples/node-security; the pushed branches are listed with the prefix `refs/heads/ludion/`, since `ludion/*` matched none, and their FROM line is shown), `github.mjs` (as is), `summary.mjs` (the image receipt's runtime and digests). New: `run.sh`, `ci.sh`, `test.sh` (a stand-in Git repository in /w, which apps/site/test/knowledge.test.ts needs), `mutate.sh`, `mutate.mjs`.

## After the R lane's review (comment 6532823264, REQUEST CHANGES at a4ee125)

main 5dc8f69 (#233) merged in (b3827ae, no conflict). Blocking: #233's osv-note.test.ts needs every host in packages/cli/src named in `SCAN_NOTE`; the note now names nodejs.org (the release index, downloaded whole) and the image tag (library/php or library/node) sent to Docker Hub. Non-blocking, fixed with tests only: the index request's `redirect: "error"` and 30 s deadline, the PR job refusing a FROM pinned at the same version (Node.js and PHP), and PHP's hyphen refusal; README says when init asks for --ecosystem and that a floating `node:` tag makes scan exit 2. Not changed: the order of PHP's hyphen check after the ADD/COPY/RUN check (both refuse).

At c00f523: tsc exit 0; the node project 37 files, 1,238 passed, 19 skipped, osv-note.test.ts 6 passed (logs/test-fix.log). Mutations: the 26 above plus the review's four survivors (M1, M9, D2, H1), 30 of 30 caught (logs/mutate-fix.log).

## After R231c's review (comment 6534443349, APPROVE at 374d703, non-blocking 1 and 2)

1. An unconfigured `scan` left out `FROM --platform=… node:…`, `FROM docker.io/node:…`, `FROM index.docker.io/library/node:…` and `FROM node@sha256:…`, and beside an npm lockfile exited 0, while README.md:100 said such lines make scan exit 2. `NODE_FROM` (packages/cli/src/security/node.ts) now takes any `FROM` line that names a node image (`--flag` arguments, any registry or namespace prefix, `node` followed by `:`, `@`, a space or the end of the line), still only on `FROM`. What `nodeImage` reads is unchanged, so each of those forms is a node check that could not be made. README.md:100 (and packages/cli/README.md) names the forms; the decision has an addendum.
2. docs/progress/2026-10-31-lnode-node-image.md and the PR body give the numbers below.

At 675a75b, with `scripts/run.sh full` (new: `npm run build`, `npm run typecheck`, `npm test -- --maxWorkers=2`, every vitest project, `--network none`, `--memory 4g`): build exit 0, typecheck exit 0, `Test Files  38 passed (38)`, `Tests  1260 passed | 19 skipped (1279)` (logs/full-lnode3.log). node-image.test.ts has 43 tests: the forms above and `FROM node`, `FROM node AS build`, `from Node:22-alpine` and `ghcr.io/acme/node` each give `node:error` and exit 2, alone and beside a clean npm project; `COPY --chown=node:node`, `USER node:node`, `nodejs:22`, `acme/node-app`, `php … AS node` and a commented `# FROM node` give no node check, and `--platform` with php stays PHP's check. Mutations: 37 of 37 caught, N1–N7 the detection's (logs/mutate-lnode3.log). The first `full` run at eba6ded failed 14 of these tests only because the npm stand-in had no package.json (its own check failed); 675a75b adds it.

## After R231d's review (comment 6535222762, REQUEST CHANGES at c873956)

B1: a Dockerfile starting with a UTF-8 byte-order mark was not detected (`NODE_FROM` is anchored at `^[ \t]*FROM`), so an unconfigured scan beside an npm lockfile left the node image out and exited 0. As decided in ludion-ops#1 (6535572537, item 2), Ludion now reads a Dockerfile as Docker does: `withoutBom` (php.ts) removes one leading U+FEFF; `namesNodeImage` (node.ts) detects on that string for init and scan, and `officialImage` reads it for both PHP and Node.js, keeping `start` and `end` as offsets in the file as given, so an update keeps the mark. PHP's detection (`\bphp:`, not anchored) did not miss the file; PHP's reading goes through the same `officialImage`. Tests: `\u{FEFF}FROM node:22-alpine` in the failed-check table (node:error, exit 2, alone and beside npm); `FROM node:22.23.4`, `FROM node:22.11.0-alpine` and `FROM php:8.4.27-fpm`, each with and without the mark, give the same check, the same exit (0, 1, 1) and init's question; patch keeps the mark (bytes EF BB BF) and changes only FROM; two marks before PHP's FROM are refused. R231d's surviving R2 (a pin other than `@sha256:` and 64 lower-case hex), R4 (a PHP policy refusing a receipt whose scan says node or php) and R5 (a saved node policy with `FROM ${IMG}`) now have tests.

At 2407a63 (the code and tests at 51e905e, which changes only mutate.mjs): build exit 0, typecheck exit 0, `Test Files  38 passed (38)`, `Tests  1275 passed | 19 skipped (1294)` (logs/full-lnode4.log). Mutations at 51e905e: 43 of 44 caught, 0 not applied (logs/mutate-lnode4.log). The one that survives, B4 (reading without removing the mark), is equivalent: JavaScript's `\s` already matches U+FEFF, so `officialImage` gave the same result before; the removal is there so detection and reading use the same string, as decided.

Not kept: the first runs of LNODE4 had the mark written into the source as the raw character (the editing tool turned the escape into it), and then, after a sed, as the text `FEFF`; both were found before any commit and replaced with the escape `\u{FEFF}`. No raw U+FEFF is in packages/cli/src or packages/cli/test.
