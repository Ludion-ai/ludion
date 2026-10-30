# LB2a (#215): the lock reader against locks npm wrote (2026-10-31)

What was made under docs/decisions/2026-10-31-lock-corpus-against-npm.md (committed at 50a531c, before the corpus), and what the reader does with it. The files are in packages/cli/test/fixtures/npm-corpus/; packages/cli/test/npm-corpus.test.ts reads them with no network.

## How it was made

All in Docker, one container at a time, each after `docker run --rm alpine free -m`, with `--memory 2g`, `--cap-drop ALL`, `--user node` and no credentials, in the volume `ludion-lb2a-corpus`:

1. `scripts/gen.sh`, in each image below, with the network (the public registry's manifests only): each shape's package.json, then `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --lockfile-version=<2|3>` (and `--legacy-peer-deps` for that shape). npm's output is in `npm.log` and its exit code in `npm.exit`, beside each lock.
2. `scripts/variants.mjs`, in the npm 11.19.1 image with `--network none`: the variants V0 to V5 of each written lock, each one change made alike in `packages` and in a v2 lock's npm 6 tree, and `corpus.json` (which npm, which lockfileVersion was asked and written, which variants, which path each changes).
3. `scripts/ls.sh`, in the image that wrote each lock, with `--network none`: `npm ls --all --package-lock-only --json` on every base lock and variant, into `ls.json`, `ls.err` and `ls.exit`.

| npm | node | image |
|---|---|---|
| 7.10.0 | 16.0.0 | `node@sha256:2cc239701e22ed59a2c918f4ba3625a3516b461010b5ce252efdd75e51e2b28b` |
| 8.19.4 | 16.20.2 | `node@sha256:3ebf2875c188d22939c6ab080cfb1a4a6248cc86bae600ea8e2326aa03acdb8f` |
| 9.8.1 | 18.18.2 | `node@sha256:caea82ddba051b3f8157bf6d12c732d6f232b56af0dcefd4b51d8d9f5196e9dd` |
| 10.8.2 | 20.19.2 | `node@sha256:7cd3fbc830c75c92256fe1122002add9a1c025831af8770cd0bf8e45688ef661` |
| 11.19.1 | 24.22.2 | `node@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c` |

## What npm wrote

Five npm versions × two lockfileVersions asked × six shapes = 60 projects. 50 locks were written, 226 variants (V0 included).

| shape | npm 7.10.0 | npm 8.19.4 to 11.19.1 | variants (each written lock) |
|---|---|---|---|
| peer-devoptional-alias | written | written | V0 to V4 |
| overrides | written | written | V0 to V3; V5 from npm 8 on |
| nested-overrides | written | written | V0 to V3; V5 from npm 8 on |
| workspaces | written | written | V0 to V3 |
| legacy-peer-deps | written | written | V0 to V3 |
| bundled | not written (exit 254) | not written (exit 254) | none |

- **npm 7.10.0 writes lockfileVersion 2 when 3 is asked.** Its five "v3" locks are lockfileVersion 2 and are counted as v2 (the decision: not counted as that version). So lockfileVersion 3 is covered by npm 8 to 11 only.
- **npm 7.10.0 does not read `overrides`** (npm 8.3 added them): its overrides locks have no overridden copy, so no V5.
- **bundled, in every version:** npm tries to pack the workspace that lists `bundleDependencies` and looks for it one folder too high (`npm.log`: "tarball data for file:../packages/b (null) seems to be corrupted", then ENOENT on `/out/<npm>/v<n>/packages/b/package.json`). No lock with `inBundle` entries could be written from manifests alone, so **bundled entries are not in the corpus**.
- npm's report on the base locks: no counted problem, except legacy-peer-deps (`missing: react@^18.2.0, required by react-dom@18.2.0`, the peer `--legacy-peer-deps` leaves out) and every npm 7.10.0 lock (below).

## The gates

- **G3 (every base lock npm writes is read): met.** 50 of 50 (14 were refused before the changes below).
- **G1 (no narrowing against main's reader): met.** All 276 locks and variants main's reader reads are read.
- **G2 (`newUnmetRequirements` non-empty exactly when npm ls reports a new `missing:` or `invalid:`): not met, for one form.**
  - Compared: the 184 variants of npm 8 to 11 (V0 included). npm 7.10.0's 42 are not compared: its `npm ls --package-lock-only` reports from `node_modules`, which the corpus does not install, so it reports every dependency missing (for example `missing: mkdirp@0.5.6, required by s2@1.0.0` on the base lock). Its report cannot say whether a lock meets its requirements.
  - Agree: 144 of 184. V0, V1, V2, V4 and V5 agree in every case.
  - **Disagree: 40 of 184, every V3 of npm 8 to 11 (40 of 40).** V3 gives an entry a range requires `name: "left-pad"` (in a v2 tree, `npm:left-pad@<version>`). npm ls reports no problem: npm takes a copy whose version is in the range as meeting it, whatever package the copy is. Ludion reports the requirement unmet ("node_modules/minimist has left-pad@1.2.5, which is not that"). At run time, `require("minimist")` would load left-pad.
  - The reader was **not** changed to take V3. Taking it would accept another package installed under a required name as meeting the requirement, which adds supply-chain risk (CLAUDE.md, Product). The decision's rule for this case applies: the form cannot be agreed with, so the lane stops on it and reports it with its count. npm-corpus.test.ts holds the result as it is: the 40 V3 disagreements and no other; a new disagreement of any kind fails the test.

## First run, and what changed

The first run of the test at 50a531c's reader (`npm-corpus.test.ts`, before the fixes):
- **G3: 14 base locks refused.** Six for the npm 6 tree's `devOptional`, a key outside the closed list (review 6533374683, B1): peer-devoptional-alias at lockfileVersion 2, in every npm version (npm 7.10.0's two included). Eight for the v2 overrides and nested-overrides locks of npm 8 to 11: their tree writes the override's spec in `requires` (`"minimist": "1.2.5"`) where `packages` writes the package's own (`"^1.2.6"`), so the views disagreed.
- **G1: 84 locks and variants narrowed**, for the same two causes.

Changed in judge.ts:
- `devOptional` and `peer` are tree keys, compared between the views as flags like `dev`, `optional` and `bundled`.
- The views compare each entry's requirements by name. Whether each copy is what its spec asks is the requirement check's question, asked in each view.
- Where an override applies to a requirement, the copy is checked against the override's spec only, as npm does (review 6533374683, B2). Before, a copy meeting the requirement's own range was also taken. V5 shows the difference: npm reports `invalid` and Ludion now agrees.

## What this does not cover

- Bundled entries (`inBundle`): npm wrote none here.
- npm 7.10.0's requirement reading: its `npm ls` cannot report it from a lock.
- npm versions and shapes outside the table; what npm does at install time beyond `npm ls --package-lock-only`.
- V3's form in real lockfiles: how often an entry is another package than its path's name without an `npm:` alias spec was not measured. That waits for the next instruction.
