# LOLD: resolving to the oldest version in range (definitions, fixed before the prototype runs)

Measurement and prototype only. No product behavior changes, and the wait table, gates and scope are not changed. This file is committed before any resolver runs and is not changed after a result is seen. The scripts may be debugged after this commit; a change to what they measure is not allowed.

## 1. The question

Can Ludion produce, from a package-lock.json (v3) and one advisory (name, vulnerable range, V), a lockfile diff that puts V in and in which every other version that has to move is the oldest version in range with no advisory, deprecation or withdrawal, using npm's own resolver and writer where possible, in a form that real npm 12.2.1 accepts?

The rule under test, as the owner's plan words it: every version in the diff is resolved at T, the time the advisory was first seen; V is the smallest fixed version; a version other than V that has to move is the oldest that satisfies the range and has no advisory, deprecation or withdrawal; a version already in the lockfile does not move while it satisfies the range.

## 2. What npm 12.2.1 offers (read before this file was written)

Read inside Docker, in the pinned npm 12.2.1's own files:

- `docs/content/using-npm/config.md` and `@npmcli/config/lib/definitions/definitions.js`: `before`, `min-release-age` and `min-release-age-exclude` exist. They cut off new versions by date. No option selects the lowest or the oldest version.
- `npm-pick-manifest/lib/index.js`: among the versions in range it sorts by not avoided, not restricted, not staged, not deprecated and engine ok, engine ok, not deprecated, then `semver.rcompare`. `before` only filters. So the highest allowed version always wins and no setting reverses that.
- Scoped `overrides` could force a version per edge, but they need the answer first and leave a change to make in package.json.

So npm has no mechanism for this, and the prototype chooses from the packument itself.

## 3. The mechanism

`scripts/oldest.mjs` loads the pinned npm 12.2.1's own Arborist and replaces one function in the process, `pacote.manifest`. When Arborist asks for a registry range, the replacement answers with the version the rule in section 4 chooses and then lets pacote read that exact version. Everything else stays npm's: which edges are unmet, where a package is placed, peer sets, flags, and writing the lockfile. It runs the product's two steps (packages/cli/src/security/inventory.ts, `changedManifest`, and dependency-patch.ts, `resolverDockerfile`): a pinned manifest first (a direct dependency at V, or a transitive one through the override `name@from: V`), then the final manifest with the same lockfile.

`pacote.extract` and `pacote.tarball` are replaced by a function that throws, so no tarball is fetched. A package with bundled dependencies, which npm reads from its tarball, therefore fails with `tarball_needed`. The real npm commands of section 7 run with the product's flags, `--allow-remote=none` and the others.

Nothing here is a design for the product, whose rules on dependencies are CLAUDE.md's; the report says what it would take.

## 4. The oldest version in range

For a requirement `name@range` from any package that has to resolve (npm decides which edges are unmet; an edge a locked version already satisfies is never asked about):

- **The packument at T.** Today's full packument, keeping only versions with a `time` entry at or before T. A version without a `time` entry is excluded, counted as `no_time`. Today's packument is what can be read: a version removed since T is not selectable, and it cannot be told from one never published.
- **In range.** `semver.satisfies(version, range, { loose: true })`, as npm-pick-manifest does; a prerelease is in range only as semver says.
- **Excluded.**
  - Advisory: any advisory the registry's advisory endpoint returns for the name whose `vulnerable_versions` includes the version. All the name's versions at or before T are sent, names and versions only.
  - Deprecation: the version's `deprecated` field in today's packument.
  - Withdrawal: a version with a `time` entry and no `versions` entry (unpublished).
  - Each excluded version is counted by reason per example.
- **Oldest.** The earliest `time`; on a tie, the lowest by semver. Earliest publication, not lowest semver, because age is what the rule relies on: a backport 1.2.9 published after 2.0.0 is the younger of the two.
- **A version already in the lockfile comes first.** If the base lockfile holds, at any path, a version of the name that is in range and not excluded, the oldest such version is taken, since it brings in no new code. It is marked `reused_base`.
- **V.** The advisory's own package at a requirement that includes V resolves to V. V is not filtered. It is V by the input, and whether it is deprecated is left to the gates.
- **Nothing left.** If no version remains, the example is `stopped_no_allowed`, with the requirement and the counts by reason. Falling back to an excluded version is not allowed.
- **Tags and other specs.** An `npm:` alias is resolved by its target's range. A dist-tag requirement (`latest`) stops as `stopped_no_allowed` with the reason `tag`, since a tag cannot be resolved at T from today's packument. Git, URL, file and directory requirements stop with the product's flags.
- **Limits of "as of T".** Advisories and deprecations are today's, not T's. So the filter knows more than a run at T would have known, in the strict direction. A version's `time` is the registry's.

**T.** For a row of backtest v4: the later of `advisory_published` and `fix_published`, since Ludion cannot see an advisory's fix before both exist. For the two hand-written examples (section 5): V's publish time plus one hour, stated as synthetic.

**Peers.** A non-optional peer goes through npm's peer-set logic, with the same choice. An optional peer is not added. An `ERESOLVE` from npm fails the example and counts as a peer conflict; there is no retry with another version and no `--legacy-peer-deps`. Peer problems in the final lockfile are counted from `npm ls`.

**Duplicates.** npm places packages. No dedupe step is added, and nothing is done about duplicates beyond counting them: names with two or more distinct versions, in the base, the oldest lockfile and the normal one.

## 5. The examples

The set is fixed in `examples.json`, made by `scripts/select.mjs` from `docs/bench/2026-10-28-backtest-v4/fixes-v4.json`, in the file's order (the rows are ordered by the sample's hash), which reads metadata only and runs no resolver.

- A row is eligible when `from` and `to` are both listed today and `to` has a dependency range (dependencies, optional, non-optional peers) that is new or changed from `from`, so that a version may have to move.
- A row whose tree had more than 500 versions in v4 is left out, as too large for one container with 2 GiB.
- **R01 to R20:** the first 20 eligible rows, one per package name.
- **R21, R22:** the next 2 eligible rows with a new or changed non-optional peer range, one per package name.
- A next row: the repository's `examples/` has no Next.js project, so the first eligible `next` row stands for it. It came in among the first 20, as R03.
- **C1:** `examples/npm-security` with its own lockfile (lodash 4.17.20, V 4.17.21), the owned example, as a control that moves nothing but V.
- **T1:** a transitive fix, written by hand: a project with `micromatch@4.0.5` locked with `--before=2024-01-01T00:00:00Z`, advisory GHSA-grv7-fg5c-xmjg on braces `<3.0.3`, V 3.0.3. It is here because every row is a direct dependency, and most real fixes are not.

From the selection: of 200 rows, 8 have a version no longer listed, 89 have a new or changed range (13 of them a peer's), 20 of those are over the size limit, 69 are eligible. Those counts are in `examples.json`.

**The base lockfile of a row.** A project with one dependency, `name` at exactly `from`, and a lockfile written by npm 12.2.1 with `--before=<from's publish time + 1 hour>`: the state of a project that took `from` when it was new, the case in which most ranges are unmet. A base that cannot be built is `no_base` and is not counted.

## 6. What each example reports

Raw values, per example, in `results/<id>.json`:

- T, V, V's publish time, the outcome.
- Every non-V version added or moved: path, from, to, publish time, age at T in hours, `oldest` (below), `reused_base`, install script flag, engines not matching Node 24.
- Paths removed and flag-only changes, counted apart.
- How many versions were excluded, by reason (advisory, deprecated, withdrawn, after T, no_time), and on which names.
- The comparison in section 7, peer problems and duplicates.

## 7. Checks and comparison

`scripts/verify.mjs` reads the lockfiles as plain JSON, reads packuments on its own with `fetch`, and shares no code with the replacement in `oldest.mjs`, apart from semver.

An example is `built` only when all of these hold:

- **I1.** No path in the result holds a version in the vulnerable range, and V is at every path where the base held one.
- **I2 (the assert).** Every non-V version added or moved was published at or before T.
- **I3.** Every non-V version added or moved is the oldest of section 4 for the ranges of every package that loads it from that path by Node's lookup, or is `reused_base`.
- **I4.** A path that moved held a version that fails the range of a package that loads it in the result, so nothing moved without need.
- **I5.** With real npm 12.2.1 and the product's flags on the final package.json and lockfile: `npm ci --dry-run --ignore-scripts` exits 0, and `npm ls --all --package-lock-only` reports no problem the base lacks.
- **I6.** `npm install --package-lock-only --ignore-scripts` on the result leaves the lockfile byte for byte the same.

Comparison, from the same base lockfile, with real npm 12.2.1 and no replacement, by the same two steps:

- **Normal:** `npm install --package-lock-only --ignore-scripts` today. Age is measured from its run.
- **Normal at T:** the same with `--before=<T>`. Age is measured from T. Added here because normal resolution today answers with versions that did not exist at T.

For each: the number of non-V versions added or moved; the paths at which its version differs from the oldest lockfile's, over the union of paths either moved; the youngest age among its non-V versions added or moved; how many were published after T.

## 8. How the answer is decided

Per example: `built`, `stopped_no_allowed` (the rule ran and stops, section 4), `failed` (a check fails, npm refuses, `ERESOLVE`, `tarball_needed`, an advisory or registry read fails, or the 15 minutes per run are exceeded), or `no_base` (not counted).

Over the counted examples (`built` + `stopped_no_allowed` + `failed`):

- **Built (作れた):** no `failed`, `stopped_no_allowed` at most 10% of the counted examples, and at least 5 `built` examples with at least one non-V version moved.
- **Cannot be built (作れない):** fewer than half of the counted examples are `built`.
- **Partial (部分的):** anything else. The reasons are given by count.

The 10% and the half are this lane's reading; the plan gives no number. These are thresholds for one prototype's word, not for any gate.

**The alternative.** Unless the answer is Built, the plan's alternative runs on the same examples: resolve at T with a floor of 72 hours of age on every version but V, by npm's own flags: `--before=<T - 72h>` and `--min-release-age-exclude=<name>`. Reported per example: whether npm builds the lockfile, I1, I5 and I6, and a check in place of I2 and I3 that every non-V version added or moved was published at or before T - 72h.

## 9. What this does not measure

- Whether the oldest version works. Gate 3 is not run, and no candidate code is run or unpacked.
- Whether the rule stops malicious versions. That is the backtest's arm, not this.
- A parent whose range excludes V: the first step's override forces V, the second step's final manifest then leaves that edge unmet, and I1, I5 or I6 fails. The example then counts as `failed`; none of the chosen rows should do this, since each is a direct dependency.
- pnpm, yarn and bun lockfiles.
- A base lockfile that is anything but one dependency taken when new, apart from C1 and T1. Real projects have larger trees, where a requirement is more often already met.

## 10. How it runs

In Docker only: `node:24`, the worktree read-only, `--user node`, `--cap-drop ALL`, `--memory 2g`, no Docker socket, writes to a Docker volume. Install scripts are off everywhere. The network is used for the registry's metadata: packuments, and the advisory endpoint on the same host (`/-/npm/v1/security/advisories/bulk`), which is the one read that is not a packument; there is no other source of advisories inside the plan's limit on the network, and without it the rule's advisory exclusion could not be tested. No candidate tarball is fetched. The pinned npm 12.2.1 itself is installed from the registry into the volume, as the product's resolver does.
