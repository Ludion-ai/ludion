# LB2a (#215): the lock reader against locks npm wrote (2026-10-31)

What was made under docs/decisions/2026-10-31-lock-corpus-against-npm.md (committed at 50a531c, before the corpus) and docs/decisions/2026-10-31-lock-corpus-npm12.md (committed at e97202b, before npm 12.2.1's part), and what the reader does with it. The files are in packages/cli/test/fixtures/npm-corpus/; packages/cli/test/npm-corpus.test.ts reads them with no network, and runs npm 12.2.1 again in Docker where Docker is present (always in CI).

## How it was made

All in Docker, one container at a time, each after `docker run --rm alpine free -m`, with `--memory 2g`, `--cap-drop ALL`, `--user node` and no credentials, in the volume `ludion-lb2a-corpus`:

1. `scripts/gen.sh`, in each image below, with the network (the public registry's manifests only): each shape's package.json, then `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --lockfile-version=<2|3>` (and `--legacy-peer-deps` for that shape). npm's output is in `npm.log` and its exit code in `npm.exit`, beside each lock.
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

Six npm versions × two lockfileVersions asked × six shapes = 72 projects. 60 locks were written, 272 variants (V0 included): 332 locks in all.

| shape | npm 7.10.0 | npm 8.19.4 to 12.2.1 | variants (each written lock) |
|---|---|---|---|
| peer-devoptional-alias | written | written | V0 to V4 |
| overrides | written | written | V0 to V3; V5 from npm 8 on |
| nested-overrides | written | written | V0 to V3; V5 from npm 8 on |
| workspaces | written | written | V0 to V3 |
| legacy-peer-deps | written | written | V0 to V3 |
| bundled | not written (exit 254) | not written (exit 254) | none |

- **npm 7.10.0 writes lockfileVersion 2 when 3 is asked.** Its five "v3" locks are lockfileVersion 2 and are counted as v2 (the decision: not counted as that version). So lockfileVersion 3 is covered by npm 8 to 12.
- **npm 7.10.0 does not read `overrides`** (npm 8.3 added them): its overrides locks have no overridden copy, so no V5, and npm 12.2.1 reports their copy invalid against the project's override.
- **bundled, in every version:** npm tries to pack the workspace that lists `bundleDependencies` and looks for it one folder too high (`npm.log`: "tarball data for file:../packages/b (null) seems to be corrupted", then ENOENT on `/out/<npm>/v<n>/packages/b/package.json`). No lock with `inBundle` entries could be written from manifests alone, so **bundled entries are not in the corpus**.

## The gates

- **G3 (every base lock npm writes is read): met.** 60 of 60 (14 were refused before the changes below).
- **G1 (no narrowing against main's reader): met.** All 332 locks and variants main's reader reads are read.
- **G2 (`newUnmetRequirements` non-empty exactly when npm 12.2.1's report has a new `missing:` or `invalid:`): not met, for one form.**
  - Compared: all 272 variants, of every npm version (V0 included).
  - Agree: 216 of 272. V0, V1, V2, V4 and V5 agree in every case, and so do 4 of the 60 V3 (below).
  - **Disagree: 56 of 272, all V3, all one way: npm takes the change, Ludion refuses it.** V3 adds `name: "left-pad"` to an entry a range requires (in a v2 tree, the version becomes `npm:left-pad@<version>`); its `resolved` and `integrity` still name the original package's tarball. npm's report on the variant is byte for byte its report on the base, in npm 12.2.1 and in npm 11.19.1: npm checks a range against the copy's version, not against which package it is. Ludion reports the requirement unmet (for example "node_modules/mkdirp requires minimist ^1.2.6, and node_modules/minimist has left-pad@1.2.5, which is not that").
  - The 4 V3 that agree are npm 7.10.0's overrides and nested-overrides locks. npm 7.10.0 left the copy outside the project's override, so npm 12.2.1 already reports it invalid in the base, and reports the renamed copy as a new invalid line ("minimist@npm:left-pad@1.2.8"); Ludion also finds a new unmet requirement.
  - By the npm that wrote the lock: 7.10.0 6 of 10 V3, 8.19.4 to 12.2.1 10 of 10 each.
  - Main's reader reads every one of these locks (G1). Main has no requirement check: its `lockDiff` reports the change as left-pad at the same version replacing the original package (for example `left-pad 1.2.5, replaced minimist@1.2.5`).
  - The reader was **not** changed to take V3: taking it would accept another package named at a required path as meeting the requirement. It waits for the brain's rule on that form. npm-corpus.test.ts holds the result as it is: these 56 disagreements and no other; a new disagreement of any kind fails the test.
- **npm 11.19.1 against npm 12.2.1:** the two say the same (npm-unmet or not) of every one of the 272 variants.
- **The Docker test** runs npm 12.2.1 again on all 332 locks and requires its counted problems to be the committed `ls-12.2.1.json`'s. Run by hand here with the same commands: 332 reports. In CI it runs on every push.

## First run, and what changed

The first run of the test at 50a531c's reader (npm 7 to 11, each lock reported on by the npm that wrote it):
- **G3: 14 base locks refused.** Six for the npm 6 tree's `devOptional`, a key outside the closed list (review 6533374683, B1): peer-devoptional-alias at lockfileVersion 2, in every npm version (npm 7.10.0's two included). Eight for the v2 overrides and nested-overrides locks of npm 8 to 11: their tree writes the override's spec in `requires` (`"minimist": "1.2.5"`) where `packages` writes the package's own (`"^1.2.6"`), so the views disagreed.
- **G1: 84 locks and variants narrowed**, for the same two causes.

Changed in judge.ts:
- `devOptional` and `peer` are tree keys, compared between the views as flags like `dev`, `optional` and `bundled`.
- The views compare each entry's requirements by name. Whether each copy is what its spec asks is the requirement check's question, asked in each view.
- Where an override applies to a requirement, the copy is checked against the override's spec only, as npm does (review 6533374683, B2). Before, a copy meeting the requirement's own range was also taken. V5 shows the difference: npm reports `invalid` and Ludion now agrees.

## What this does not cover

- Bundled entries (`inBundle`): npm wrote none here.
- npm versions and shapes outside the table; what npm does at install time beyond `npm ls --package-lock-only`.
- V3's form in real lockfiles: how often an entry is another package than its path's name without an `npm:` alias spec was not measured. That waits for the next instruction.
