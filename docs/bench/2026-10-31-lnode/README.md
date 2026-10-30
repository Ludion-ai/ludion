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
