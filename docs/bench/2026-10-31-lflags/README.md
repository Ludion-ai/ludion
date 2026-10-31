# LFLAGS: npm's flags from the lock's graph, and optional peers (2026-10-31)

**Narrowed the same day (the brain's ludion-ops#1 comment 6542470518, 6, item 4).** #240 keeps the optional peers (section 1 of the decision; "The forged variants" below) and N1 and N2. It adds gate 2's checks of every entry whose flags alone changed (docs/decisions/2026-10-31-flag-only-entries-gate2.md). The flags computed from the lock's graph left #240 for a separate lane. "F1" and the first "Mutations" below record that code as it stood at 39ee847, for that lane; it is not in #240 any more. See "After the narrowing" at the end.

What was made and run under docs/decisions/2026-10-31-lock-flags-from-graph.md (committed at 9ed2aa2, before any of it). Fixtures in packages/cli/test/fixtures/npm-corpus/extra/; the tests that read them are packages/cli/test/npm-corpus.test.ts ("LFLAGS: …") and packages/cli/test/deliver.test.ts.

## How it was made

All in Docker, one container at a time (after `docker run --rm alpine free -m`: 10,621 MB free), `--cap-drop ALL`, `--user node`, `--memory 2g`, no credentials, in the volume `ludion-lflags-out`:

1. `scripts/gen.sh`, in npm 12.2.1's image (`ludion-test-npm-12.2.1`, from fixtures/npm-corpus/npm-12.2.1.Dockerfile), with the network for the public registry's manifests: X1, X2, X4 and X5 at lockfileVersion 2 and 3, the base from each project's package.json, then the fix from the base's lock with node-fetch at 2.6.7, twice, with dependency-patch.ts's npm flags. Output: logs/gen.log.
2. `scripts/variants.mjs`, in the same image with `--network none`: the forged variants B, C, E, P and R of extra/node-fetch's two fix locks. Output: logs/variants.log.
3. `scripts/ls.sh`, in npm 12.2.1's image and in npm 11.19.1's (`node@sha256:c86ecead…`, node 24.22.2), with `--network none`: `npm ls --all --package-lock-only --json` on all 26 new locks. Output: logs/ls.log.
4. `scripts/probe-dev-and-prod.sh` (added after the decision, not a gate): a project listing left-pad in both `dependencies` and `devDependencies`, to see which group npm 12.2.1's flags follow. Output: logs/probe-dev-and-prod.log.

npm 12.2.1's own rules were read in its image, not taken from memory: @npmcli/arborist's lib/calc-dep-flags.js, lib/node.js (`_loadDeps`, `unsetDepFlags`), lib/edge.js and lib/shrinkwrap.js, and build-ideal-tree.js's `#fixDepFlags`.

## What npm did

| project | base (v2, v3) | fix (v2, v3) | npm 12.2.1 / 11.19.1 `npm ls` on the fix |
|---|---|---|---|
| X1 `optionalDependencies` whatwg-url | exit 0, 0 | exit 0, 0 | no problem |
| X2 `peerDependencies` whatwg-url | exit 0, 0 | exit 0, 0 | no problem |
| X4 `"encoding": "npm:left-pad@1.3.0"` | exit 0, 0 | **exit 1, 1: ERESOLVE** ("peerOptional encoding@"^0.1.0" from node-fetch@2.6.7"); the lock is left as the base's | `invalid: node-fetch@2.6.1` (the base's lock under the fix's package.json) |
| X5 encoding 0.1.13 | exit 0, 0 | exit 0, 0 | no problem |

- X1: npm drops `optional` from whatwg-url, tr46 and webidl-conversions; X2 drops `peer` from them. Nothing else of theirs changes (deliver.test.ts checks it on both lockfileVersions).
- X4: npm 12.2.1 does not write a fix whose optional peer finds another package. So rule 2 of the decision refuses nothing npm writes, and the decision's fallback does not apply: rule 2 is taken.
- Root listed in both groups (the probe): npm 12.2.1 writes `"dev": true` on left-pad, as its `_loadDeps` order (dev last) gives.

## The forged variants (P1)

| variant | npm 12.2.1 and npm 11.19.1 `npm ls` | Ludion |
|---|---|---|
| B: `evil-pkg@1.0.0` at node_modules/node-fetch/node_modules/encoding | no problem (exit 0) | refused: the requirement check (rule 2), "…node_modules/node-fetch/node_modules/encoding has evil-pkg@1.0.0, which is not that." |
| C: the same at node_modules/encoding | `invalid: encoding@npm:evil-pkg@1.0.0` (exit 1) | refused (rule 2) |
| E: `encoding@9.9.9` at node_modules/encoding | `invalid: encoding@9.9.9` (exit 1) | refused (rule 2) |
| P: encoding 0.1.13's tarball named `left-pad` at node_modules/encoding | no problem (exit 0) | refused (rule 2: the identity rule) |
| R: the real encoding 0.1.13 (and iconv-lite, safer-buffer) nested under node-fetch | no problem (exit 0) | refused: the walk (rule 1), "…adds node_modules/node-fetch/node_modules/encoding, …, which no package the fix moves or adds requires." |

The same in v2 and v3. npm ls does not report a peer nested under its dependent (B, R), nor a location's identity (P, as for V3); the expected answer was fixed as "refused" before (decision, section 4, P1).

## F1: the computed flags against the flags npm wrote

`computedFlags` (judge.ts) on every lock npm wrote that the tests hold: 102 locks (the corpus's 72 bases, the 12 inbundle locks, the 4 node-fetch locks, X1, X2 and X5's 12 and X4's 2 bases; X4's fix lock is its base's). Every entry that is not the root or a link is compared, as `writtenFlags` writes both.

- **npm 12.2.1's 32 locks: no entry differs.**
- **The other npm versions' 70 locks (7.10.0, 8.19.4, 9.8.1, 10.8.2, 11.19.1): no entry differs either.**
- The locks carry flags to compute: across the 104 npm-written lock files (packages and npm 6 trees together), `"dev": true` 47 times, `"optional": true` 105, `"devOptional": true` 19, `"peer": true` 28, `"extraneous": true` 0.

## Mutations

`scripts/mutate.mjs`, run by `scripts/run.sh mutate` in `ludion-l9-node24-git` with `--network none`, on the volume `scripts/run.sh test` installed. 25 mutations; each result is also in logs/mutate-results.tsv (commit, result, seconds, name).

- **At 6a0f1b3 (logs/mutate.log): 24 of 25 caught**, none by the 300 s limit; both test files pass without mutations. The shell that started the run was stopped by Claude Code for low memory while it ran; the container went on and finished (its log ends with the summary line).
- **Not caught there: 5, "an optional peer that another group names checked as a peer too"** (npm's later edge replaces the peer's). No test had such an entry. bdb5fba adds one (npm-corpus.test.ts, "the project's optional peer: met when missing, checked when there").
- **At 39ee847 (logs/mutate-5.log): 5 caught.**

## What this does not cover

- Gate 2's checks of an entry whose flags alone changed (docs/decisions/2026-10-31-lock-flags-only.md, section 4): not built here.
- npm versions other than the six of the corpus, `--legacy-peer-deps` fixes (`patch` never runs npm with it: the project's .npmrc is not copied into the resolver), and the linked install strategy (`install-strategy=linked`, whose .store packages arborist treats differently).
- An extraneous parent made not extraneous by a child (npm's `resolveParent` loop) is shown on a link-built graph only; npm writes no such lock in the corpus.

## After the narrowing (#240 as it is)

- The code of section 2 (`computedFlags`, `writtenFlags` and the PR job's flag check) and its tests were taken out (44da769, e67054b). The fixtures stay: X1 and X2 hold N1, and X4, X5 and the forged variants hold the optional peers.
- Gate 2 on flag-only entries: judge.ts `lockFlagChanges` and the judge's checks; judge-cli.ts and candidate-judge.ts ask the registry and OSV for those versions.
- Mutations (`scripts/mutate.mjs`, 18 in all: rule 1, rule 2, gate 2 on flag-only entries, N1, N2), `--network none`:
  - logs/mutate-narrowed-1.log (mutations 1 to 10, at 44da769): 9 of 10 caught. Number 8, "ludion judge does not ask for their facts", was not caught; no test covered `ludion judge`'s own request.
  - logs/mutate-narrowed-2.log (8 and 11 to 18, after its test in judge-cli.test.ts): 9 of 9 caught.
  - So all 18 are caught, none by the time limit; each test file passes without mutations.
