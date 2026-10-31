# 2026-10-31 — LIMGV: an official PHP or Node.js image moves to its line's newest release

Lane LIMGV, which took over LPHPV2 (PR #238, from main 9c4de68). Definitions: docs/decisions/2026-10-31-limgv-official-image-newest-release.md, committed before the code (d2542bc). Detail, scripts and logs: docs/bench/2026-10-31-limgv.

- **What changed.** `scanPhp` and `scanNode` now take the newest release of the Dockerfile's line, marked security or not, whenever the Dockerfile's version is not that release (php.ts, `newestRelease`). Before, they took the newest security release, and moved only when a new one came out. A Dockerfile version newer than every release in the official list now stops the check; before, it gave `no_newer_security_release`. A move with no newer security release has an empty `security_releases` and a null `fix_published_at`. Its commit paragraph is `No official <label> security release is newer than <old>; <new> is the newest release of its line, the only tag of the line Docker's official image still rebuilds.`, and `ludion deliver open` accepts such a receipt and says the same in the PR body (`rebuild_only`). README.md, packages/cli/README.md and docs/status.md, item 4, describe this. A mistakes record is added (docs/mistakes/2026-10-31-image-took-a-tag-no-longer-rebuilt.md).
- **LPHPV2's tests.** LPHPV2's three cases (R237's R5, R7 and R10, commit 629da46) were written for the old rule. All three are kept, rewritten for the new one: the sample listed oldest first must still give the newest release (R5, and the same for nodejs.org's index); a newer release tagged `[""]` (php.net's own shape) or a made-up `bugfix` is the candidate but not a security release (R7); and from 8.4.9, by number (R10). LPHPV2's progress record, which described them under the old rule, was never merged and is replaced by this one.
- **New tests.** The newest release not marked security is taken: php 8.4.30, node 22.23.5. A tag that is no longer the newest moves with no newer security release: php 8.4.28 and 8.4.29, node 22.23.4, and in `patch --apply`, php 8.4.27 → 8.4.28 with its commit message. On the day a later release is listed, the tag moves, and it did not move the day before. A list with no release as new as the Dockerfile's stops: php 8.4.31, 8.4.100, and 8.4.29 on a list ending at 8.4.28; node 22.23.6, 22.100.0 and 24.22.2. In the PR job, a receipt with no security release is accepted with the rebuild message and its PR body says so; the same commit with a security release listed, and a commit that claims a security release the receipt does not list, are refused.

## Results

In Docker, `--network none`, `--memory 4g`, at b74c3541fb37497b83c6e0dcfb58c96570500d8c (logs/full.log):

- `npm run build` exit 0 (5 pages), `npm run typecheck` exit 0.
- `npm test -- --maxWorkers=2` exit 0: `Test Files  39 passed (39)`, `Tests  1310 passed | 24 skipped (1334)` (main 9c4de68: `Tests  1292 passed | 24 skipped (1316)`). security.test.ts 60 tests, node-image.test.ts 61, deliver.test.ts 41, tools/records/test/records.test.ts 12.

Mutations, each applied alone, then the whole vitest run (logs/mutate.log): `caught 15, survived 0, not applied 0`.

| id | mutation | result |
|---|---|---|
| M1 | the newest security release again (LPHPV's and LNODE's rule) | caught, `29 failed` |
| M2 | move only when a newer security release exists (case 1.2 removed) | caught, `9 failed` |
| M3 | no stop when the list has no release as new as the Dockerfile's | caught, `6 failed` |
| M4 | R5: php.net's order trusted (no sort) | caught, `1 failed` |
| M5 | nodejs.org's order trusted (no sort) | caught, `1 failed` |
| M6 | R7: any tag counts as security | caught, `2 failed` |
| M7 | R10: string comparison in the security releases' filter | caught, `1 failed` |
| M8 | string comparison in the newest-release check | caught, `2 failed` |
| M9 | string comparison in the missing-list stop | caught, `4 failed` |
| M10 | Node.js alone back to its newest security release | caught, `9 failed` |
| M11 | the commit paragraph always lists security releases | caught, `3 failed` |
| M12 | the PR job requires a security release again | caught, `2 failed` |
| M13 | `rebuild_only` never set | caught, `2 failed` |
| M14 | the PR body's opening ignores `rebuild_only` | caught, `2 failed` |
| M15 | the PR body's Advisories row ignores `rebuild_only` | caught, `2 failed` |

After the runs, the three mutated files in /w were byte for byte the worktree's (`# sources restored`), and the worktree was mounted read-only.

## Not done

An end-to-end run against the real php.net, nodejs.org, Docker Hub and Docker. The CLAUDE.md sentence (LC0a), LR3, decision 4 and LDG. A rebuild of the same tag.
