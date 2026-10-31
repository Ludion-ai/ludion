# LB2a (#215): the lock reader against locks npm wrote (2026-10-31)

What was made under docs/decisions/2026-10-31-lock-corpus-against-npm.md (committed at 50a531c, before the corpus), docs/decisions/2026-10-31-lock-corpus-npm12.md (e97202b, before npm 12.2.1's part) and docs/decisions/2026-10-31-lock-corpus-alias.md (9daa1eb, before the alias shape), and what the reader does with it. The files are in packages/cli/test/fixtures/npm-corpus/; packages/cli/test/npm-corpus.test.ts reads them with no network, and runs npm 12.2.1 again in Docker where Docker is present (always in CI).

## How it was made

All in Docker, one container at a time, each after `docker run --rm alpine free -m`, with `--memory 2g`, `--cap-drop ALL`, `--user node` and no credentials, in the volume `ludion-lb2a-corpus`:

1. `scripts/gen.sh`, in each image below, with the network (the public registry's manifests only; the alias shape later with `SHAPES=alias`, which writes that shape only): each shape's package.json, then `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --lockfile-version=<2|3>` (and `--legacy-peer-deps` for that shape). npm's output is in `npm.log` and its exit code in `npm.exit`, beside each lock.
2. `scripts/variants.mjs`, in the npm 11.19.1 image with `--network none`: the variants V0 to V5 of each written lock, each one change made alike in `packages` and in a v2 lock's npm 6 tree, and `corpus.json` (which npm, which lockfileVersion was asked and written, which variants, which path each changes).
3. `scripts/ls.sh`, once in npm 12.2.1's image and once in npm 11.19.1's, with `--network none`: `npm ls --all --package-lock-only --json` on every base lock and variant, whichever npm wrote it, into `ls-<npm>.json`, `.err` and `.exit`. (The first round's reports, each by the npm that wrote the lock, are replaced; they are in Git at 7994a5d.)

| npm | node | image |
|---|---|---|
| 7.10.0 | 16.0.0 | `node@sha256:2cc239701e22ed59a2c918f4ba3625a3516b461010b5ce252efdd75e51e2b28b` |
| 8.19.4 | 16.20.2 | `node@sha256:3ebf2875c188d22939c6ab080cfb1a4a6248cc86bae600ea8e2326aa03acdb8f` |
| 9.8.1 | 18.18.2 | `node@sha256:caea82ddba051b3f8157bf6d12c732d6f232b56af0dcefd4b51d8d9f5196e9dd` |
| 10.8.2 | 20.19.2 | `node@sha256:7cd3fbc830c75c92256fe1122002add9a1c025831af8770cd0bf8e45688ef661` |
| 11.19.1 | 24.22.2 | `node@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c` |
| 12.2.1 | 24.22.2 | the 11.19.1 image with npm 12.2.1's registry tarball, checked by SHA-512, installed with `--ignore-scripts` (fixtures/npm-corpus/npm-12.2.1.Dockerfile) |

## What npm wrote

Six npm versions × two lockfileVersions asked × seven shapes = 84 projects. 72 locks were written, 320 variants (V0 included): 392 locks in all. The alias shape was added after the V3 report (docs/decisions/2026-10-31-lock-corpus-alias.md, committed at 9daa1eb before it was generated); only it was written then, and the earlier locks and reports are unchanged.

| shape | npm 7.10.0 | npm 8.19.4 to 12.2.1 | variants (each written lock) |
|---|---|---|---|
| peer-devoptional-alias | written | written | V0 to V4 |
| overrides | written | written | V0 to V3; V5 from npm 8 on |
| nested-overrides | written | written | V0 to V3; V5 from npm 8 on |
| workspaces | written | written | V0 to V3 |
| legacy-peer-deps | written | written | V0 to V3 |
| alias | written | written | V0 to V3 |
| bundled | not written (exit 254) | not written (exit 254) | none |

- **alias:** the project requires `"minimist": "npm:left-pad@1.3.0"` and mkdirp 0.5.1 (whose minimist 0.0.8 npm nests under it), and is-number 7.0.0; a workspace requires `"is-number": "npm:left-pad@1.2.0"`. Every npm wrote left-pad 1.3.0 at `node_modules/minimist`, the real minimist 0.0.8 at `node_modules/mkdirp/node_modules/minimist`, and left-pad 1.2.0 at the workspace's nested `is-number`.
- **npm 7.10.0 writes lockfileVersion 2 when 3 is asked.** Its six "v3" locks are lockfileVersion 2 and are counted as v2 (the decision: not counted as that version). So lockfileVersion 3 is covered by npm 8 to 12.
- **npm 7.10.0 does not read `overrides`** (npm 8.3 added them): its overrides locks have no overridden copy, so no V5, and npm 12.2.1 reports their copy invalid against the project's override.
- **bundled, in every version:** npm tries to pack the workspace that lists `bundleDependencies` and looks for it one folder too high (`npm.log`: "tarball data for file:../packages/b (null) seems to be corrupted", then ENOENT on `/out/<npm>/v<n>/packages/b/package.json`). No lock with `inBundle` entries could be written from manifests alone, so **bundled entries are not in the corpus**.

## The gates

- **G3 (every base lock npm writes is read): met.** 72 of 72 (14 were refused before the changes below).
- **G1 (no narrowing against main's reader): met.** All 392 locks and variants main's reader reads are read.
- **A1, A2 (alias locks): met.** All 12 alias locks are read by main and by #215, and leave no requirement unmet; npm 12.2.1 reports no problem on them.
- **G2 (`newUnmetRequirements` non-empty exactly when npm 12.2.1's report has a new `missing:` or `invalid:`), apart from V3: met.** 248 of 248 variants agree (V0, V1, V2, V4 and V5, every npm version, every shape).
- **V3: refused, by rule, all 72.** V3 adds `name: "left-pad"` to an entry a range requires (in a v2 tree, the version becomes `npm:left-pad@<version>`); its `resolved` and `integrity` still name the original package's tarball. `npm ls` does not look at which package a location holds: it checks a range against the copy's version. Ludion does look: the package at a location must be the one its spec names (the identity rule, docs/decisions/2026-10-31-lock-corpus-alias.md). So the expected answer is fixed as "refused", and the test requires it for every V3, whatever npm reports.
  - npm's report on 68 of the 72 is byte for byte its report on the base, in npm 12.2.1 and in npm 11.19.1. The other 4 are npm 7.10.0's overrides and nested-overrides locks: npm 7.10.0 left the copy outside the project's override, so npm 12.2.1 already reports it invalid in the base, and reports the renamed copy as a new invalid line ("minimist@npm:left-pad@1.2.8").
  - Ludion reports the requirement unmet (for example "node_modules/mkdirp requires minimist ^1.2.6, and node_modules/minimist has left-pad@1.2.5, which is not that").
  - Main's reader reads every one of these locks (G1). Main has no requirement check: its `lockDiff` reports the change as left-pad at the same version replacing the original package (for example `left-pad 1.2.5, replaced minimist@1.2.5`).
  - Before V3 was fixed as refused, these were counted as G2's disagreements: 56 of the 272 variants then in the corpus.
- **npm 11.19.1 against npm 12.2.1:** the two say the same (npm-unmet or not) of every one of the 320 variants.
- **The Docker test** runs npm 12.2.1 again on all 392 locks and requires its counted problems to be the committed `ls-12.2.1.json`'s. In CI it runs on every push.

## First run, and what changed

The first run of the test at 50a531c's reader (npm 7 to 11, each lock reported on by the npm that wrote it):
- **G3: 14 base locks refused.** Six for the npm 6 tree's `devOptional`, a key outside the closed list (review 6533374683, B1): peer-devoptional-alias at lockfileVersion 2, in every npm version (npm 7.10.0's two included). Eight for the v2 overrides and nested-overrides locks of npm 8 to 11: their tree writes the override's spec in `requires` (`"minimist": "1.2.5"`) where `packages` writes the package's own (`"^1.2.6"`), so the views disagreed.
- **G1: 84 locks and variants narrowed**, for the same two causes.

Changed in judge.ts:
- `devOptional` and `peer` are tree keys, compared between the views as flags like `dev`, `optional` and `bundled`.
- The views compare each entry's requirements by name. Whether each copy is what its spec asks is the requirement check's question, asked in each view.
- Where an override applies to a requirement, the copy is checked against the override's spec only, as npm does (review 6533374683, B2). Before, a copy meeting the requirement's own range was also taken. V5 shows the difference: npm reports `invalid` and Ludion now agrees.

## Added for review 6538813186: bundled entries and B1's pair

Under docs/decisions/2026-10-31-lock-flags-only.md (committed at 97f9cfc, before them), in fixtures/npm-corpus/extra/, made as above in the volume `ludion-lb2a-extra`:
1. `scripts/gen-extra.sh`, with the network:
   - `MODE=inbundle`, in each of the six images: the project `{"dependencies": {"npm": "10.9.2"}}` (npm 10.9.2 bundles its dependencies), `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --lockfile-version=<2|3>`. All twelve exited 0, each lock with 215 `inBundle` entries; npm 7.10.0 again wrote lockfileVersion 2 when 3 was asked. **npm 12.2.1 first stopped** (exit 1, `EALLOWREMOTE`, "Refusing to fetch https://registry.npmjs.org/npm/-/npm-10.9.2.tgz"; logs/gen-extra-npm12-eallowremote.log): its default `allow-remote` is `none`, and npm reads a bundling package's tarball to list what it bundles. Its two locks were written again with `--allow-remote=all`.
   - `MODE=node-fetch`, in npm 12.2.1's image: B1's project (node-fetch 2.6.1, and whatwg-url 5.0.0 as a dev dependency) at lockfileVersion 2 and 3, then the fix from that lock with node-fetch at 2.6.7, with dependency-patch.ts's npm flags (twice, as the pinned and the final manifest, which are the same here). npm drops `"dev": true` from whatwg-url, tr46 and webidl-conversions; their version, `resolved` and `integrity` do not change (both views of the v2 lock).
2. `scripts/ls-extra.sh`, in npm 12.2.1's image and npm 11.19.1's, with `--network none`: `npm ls` on all 16 locks. Every one exited 0 with no problem.

The gates of the decision:
- **B1: met.** For both node-fetch pairs, `contentProblem("npm", …)` is null, `lockEntryChanges` is only node_modules/node-fetch@2.6.7, npm 12.2.1 and npm 11.19.1 report no new problem, and `newUnmetRequirements` is empty. The PR job opens the fix (deliver.test.ts), and asks the registry only for node-fetch 2.6.7. The pair with tr46 changed in another key, its integrity, a flag that is not `true`, `inBundle`, or a flag together with another key is refused.
- **N1: met.** All 12 inbundle locks are read by main's reader and by #215's (216 entries each), and leave no requirement unmet.
- The Docker test runs npm 12.2.1 again on these 16 locks too.

## What this does not cover

- Bundled entries beyond one registry package that bundles its dependencies (npm 10.9.2): a workspace's `bundleDependencies` is still never written (exit 254 above).
- Whether a flag in a fix's lock is the one npm computes from the lock's graph (docs/decisions/2026-10-31-lock-flags-only.md: LFLAGS, after #215).
- npm versions and shapes outside the table; what npm does at install time beyond `npm ls --package-lock-only`.
- V3's form in real lockfiles: how often an entry is another package than its spec names was not measured. V3 is refused by the identity rule, so a real lock of that form is refused too.
