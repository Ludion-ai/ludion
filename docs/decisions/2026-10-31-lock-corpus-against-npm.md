# 2026-10-31 (LB2a, #215) — The lock reader is checked against what npm writes and what npm reports: a corpus, fixed before it is made

Committed before the corpus below is generated. It sets how `readLock`, `lockEntries` and `newUnmetRequirements` (packages/cli/src/security/judge.ts) are judged. It changes no gate's criteria and no wait.

**Why.** #215 had four REQUEST CHANGES in a row of the same kind (reviews 6525352604, 6527878093, 6529858505, 6533374683). Each found a lockfile form that npm writes and the reader got wrong. The latest: npm 7 to 11 write `devOptional` and `peer` in a v2 lock's npm 6 tree, and the reader refused them. The cause is not the number of fixes; there was nothing to check the reader against. So there now is one: lockfiles npm itself writes, and npm's own report on them.

## 1. The corpus (made once, committed as fixtures)

**npm versions.** Official node images, pinned by digest:

| npm | node | image digest |
|---|---|---|
| 7.10.0 | 16.0.0 | `node@sha256:2cc239701e22ed59a2c918f4ba3625a3516b461010b5ce252efdd75e51e2b28b` |
| 8.19.4 | 16.20.2 | `node@sha256:3ebf2875c188d22939c6ab080cfb1a4a6248cc86bae600ea8e2326aa03acdb8f` |
| 9.8.1 | 18.18.2 | `node@sha256:caea82ddba051b3f8157bf6d12c732d6f232b56af0dcefd4b51d8d9f5196e9dd` |
| 10.8.2 | 20.19.2 | `node@sha256:7cd3fbc830c75c92256fe1122002add9a1c025831af8770cd0bf8e45688ef661` |
| 11.19.1 | 24.22.2 | `node@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c` |

**lockfileVersion.** Each npm writes each project twice, with `--lockfile-version=2` and with `--lockfile-version=3`. A version that does not accept the setting, or writes another lockfileVersion than asked, is recorded as such and is not counted as that version.

**Projects ("shapes")**, each a package.json fixed in the generator:
1. **peer-devoptional-alias**: react-dom 18.2.0, whose peer react npm installs itself; an optional dependency that a dev dependency also needs (`devOptional`); a nested copy (mkdirp 0.5.1 with minimist 0.0.8 beside a top-level minimist); an npm alias.
2. **overrides**: a top-level override outside a dependent's range.
3. **nested-overrides**: an override nested under one package, plus a `name@selector` key.
4. **workspaces**: a workspace with its own nested copy and devDependencies, and a local `file:` folder.
5. **bundled**: a workspace whose package.json lists `bundleDependencies`.
6. **legacy-peer-deps**: shape 1's react-dom, written with `--legacy-peer-deps`.

npm runs `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`:
- in Docker, one container at a time, `--memory 2g`, `--cap-drop ALL`, `--user node`;
- with no credentials mounted;
- with the network only to the public registry.

Only manifests are fetched: no tarball is installed and no script runs. A shape npm cannot write without tarballs (for example bundled entries under `--package-lock-only`) is recorded as "not written", with what npm wrote instead.

**Variants (one change each).** From each written lock, the generator makes variants, each changing exactly one thing, in both views of a v2 lock alike:
- **V1** removes an install entry that another entry or the project requires.
- **V2** moves a required entry to a version outside every range that requires it (`99.0.0`).
- **V3** makes a required entry an alias of another package (`name: "left-pad"`).
- **V4** removes an auto-installed peer (an entry npm flagged `peer`), when there is one.
- **V5** (overrides shapes only) moves an overridden entry to the version its dependent's own range takes but the override does not.
- **V0** is the lock unchanged (a control).

**npm's report.** For the base and for each variant: `npm ls --all --package-lock-only --json`, in the same npm's image, with `--network none`, `--cap-drop ALL` and `--user node`. Its `problems` lines that start with `missing:` or `invalid:` are kept; other lines (extraneous, peer warnings) are kept but not counted. A variant is **npm-unmet** when it has a counted problem the base does not have.

Everything is committed under packages/cli/test/fixtures/npm-corpus/:
- every package.json;
- every lock and variant;
- npm's report on each;
- a manifest listing the npm versions, images, shapes and variants.

The tests read only these files and need no network.

## 2. The gates (fixed now; not loosened after the results)

- **G1, no narrowing.** Every corpus lock and variant that main's reader reads must be read by the PR's `readLock` and `lockEntries`. Main's reader is `JSON.parse`, then `packages` present, then lockfileVersion 2 or 3 (as `Number`).
- **G2, agreement with npm.** For every variant whose base and variant the PR's reader reads, `newUnmetRequirements(base, variant)` is non-empty exactly when npm's report makes the variant npm-unmet. This uses each side's package.json as its manifest.
- **G3, nothing unread.** Every base lock that npm writes is read by the PR's `readLock`.

**When a gate fails:** the reader is changed to match npm, never the other way, and never by dropping a corpus file. If a form still cannot be read or agreed with, the lane stops and reports it with its count. Measuring that form's share of public lockfiles waits for the next instruction.

**What this does not cover:**
- npm versions and shapes outside the corpus;
- what npm does at install time beyond what `npm ls --package-lock-only` reports;
- the PR job's other checks (they are unchanged by this entry).
