# 2026-10-31 — LIMGV: an official PHP or Node.js image moves to the newest release of its line that Docker still builds

Lane LIMGV, from main 355a91c, PR #239. It replaces PR #238, which was closed unmerged. Definitions: docs/decisions/2026-10-31-limgv-image-newest-built-release.md, committed before the code (dc21a94). Detail, scripts and logs: docs/bench/2026-10-31-limgv.

- **What changed.** `scanPhp` and `scanNode` (php.ts `imageMove`) take the newest release of the Dockerfile's line, marked security or not, when the Dockerfile's version is older. A list with no release as new as the Dockerfile's stops. Before a move is `update_available`, Docker Hub is asked for the candidate's tag in the Dockerfile's variant (`dockerHubTag`, the HEAD moved from deliver.ts), and a 404 stops with the reason. A move with no newer security release has these properties:
  - It waits 72 hours from the end of the release's day. Until then the status is `wait`, and `patch` does nothing.
  - Its `fix_published_at` is null (`Not counted`).
  - Its commit paragraph is `<label> <new>, the newest release of the line (no newer security release); Docker rebuilds only the newest tag of a line.`
  - The PR job accepts it only after its wait and with no `fix_published_at`. Its PR's title and body do not contain "security".
- **Tests.** security.test.ts, node-image.test.ts and deliver.test.ts cover the following:
  - the newest release not marked security (php 8.4.30, node 22.23.5);
  - a tag that is no longer the newest (php 8.4.28 and 8.4.29, node 22.23.4);
  - the move once a later release is listed;
  - the wait's edges (php: 2026-11-02T23:59:59.999Z waits, 2026-11-03T00:00Z moves; node: 2026-10-30T23:59:59.999Z, 2026-10-31T00:00Z), and no wait when a security release lies between;
  - an unreadable day;
  - the missing tag (php, with and without a security release between; node, with and without a variant), and Docker Hub down;
  - a missing list;
  - R237's R5 (order) and R10 (digit boundary);
  - in `patch`: the move applied after its wait, nothing during it, and a stop on a missing tag before Docker;
  - in the PR job: the receipt checked and refused (applied before its wait, no `wait_until`, a `fix_published_at`, a commit claiming a security release), and `openFixes` pushing and opening the PR for PHP and Node.js, with no "security" in its title or body.

## Results

In Docker, `--network none`, `--memory 4g`:

- Code and tests as at 795e97b (logs/full-1.log):
  - `npm run build` exit 0 (5 pages);
  - `npm run typecheck` exit 0;
  - `npm test -- --maxWorkers=2` exit 0: `Test Files  40 passed (40)`, `Tests  1369 passed | 25 skipped (1394)`. security.test.ts has 69 tests, node-image.test.ts 66, deliver.test.ts 60 and records.test.ts 14.
- Mutations, each applied alone, then the node project's whole vitest run (logs/mutate.log): `caught 25, survived 0, not applied 0, void 0`.

## Not done

- The hand check through both jobs against the real php.net, nodejs.org, Docker Hub and Docker. The coordinator runs it; the bench README says how.
- LDGLAT, LDG, moving a variant's OS release, the CLAUDE.md sentence (LC0a), LR3 and decision 4, and the "OS layer age" number.
