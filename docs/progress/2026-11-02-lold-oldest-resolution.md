# LOLD: can the lockfile take the oldest version in range? (2026-11-02)

Measurement and prototype only; no product behavior changes. Definitions: docs/bench/lold/definitions.md, committed at 439cbf5 before any resolver ran. Details, raw results and one correction made between two runs: docs/bench/lold/README.md.

## The answer: partial (部分的)

npm has no way to do this, and doing it inside npm's own resolver works: no example failed, all 40 moved versions were the oldest by an independent check, and real npm 12.2.1 accepted all 13 lockfiles. But 10 of the 23 counted examples stop, because nothing is left in range once today's advisories and deprecations are excluded. How many of those 10 would also have stopped on what was known at T is not known.

| Counted examples: 23 (one more has no base) | Count |
|---|---|
| Built | 13 (11 with at least one version other than V moved) |
| Stopped: nothing allowed is left | 10 |
| Failed | 0 |

Section 8's rule: no failure, but stops are 43% (10/23), over the 10% line, and built is at least half. So the word is partial, and the alternative ran.

## What npm offers

npm 12.2.1 has `before`, `min-release-age` and `min-release-age-exclude`, which only cut off new versions. `npm-pick-manifest` always sorts the versions it keeps by `semver.rcompare`, highest first. No option selects the lowest or the oldest (definitions, section 2).

So the prototype loads npm 12.2.1's own Arborist and replaces `pacote.manifest`, the one function that answers which version a range gets. Placement, peer sets, flags and the lockfile writer stay npm's. No tarball is fetched.

## Each example

Run 2, started 2026-11-01 16:30 UTC. "Moved" is versions other than V added or moved. "Differ" is the paths at which that lockfile's version differs from the oldest lockfile's. "Youngest" is in hours: at T for the oldest lockfile and for normal at T, and at the run's time for normal, which resolves today. "After T" is how many of normal's versions were published after T.

| Id | Fix | Outcome | Moved | All oldest | Youngest at T (h) | Normal: moved / differ / youngest (h) / after T | Normal at T: moved / differ / youngest (h) | Names with two or more versions: base / oldest / normal |
|---|---|---|---|---|---|---|---|---|
| C1 | lodash 4.17.20 -> 4.17.21 | built | 0 | yes | - | 0 / 0 / - / 0 | 0 / 0 / - | 0 / 0 / 0 |
| R01 | react-server-dom-turbopack 19.2.1 -> 19.2.2 | built | 2 | yes | 2.6 | 3 / 3 / 431.7 / 3 | 2 / 0 / 2.6 | 0 / 0 / 0 |
| R02 | @react-native-community/cli-server-api 19.1.1 -> 19.1.2 | stopped | - | - | - | 6 / - / 637.3 / 5 | 3 / - / 0 | 7 / - / 7 |
| R03 | next 15.5.6 -> 15.5.7 | built | 9 | yes | 3.7 | 9 / 0 / 7993.1 / 0 | 9 / 0 / 3.7 | 0 / 0 / 0 |
| R04 | react-server-dom-webpack 19.1.1 -> 19.1.2 | built | 3 | yes | 1509.5 | 3 / 3 / 431.7 / 3 | 3 / 2 / 3.7 | 1 / 1 / 1 |
| R05 | @angular/platform-server 20.2.4 -> 20.3.0 | stopped | - | - | - | 5 / - / 44.2 / 1 | 4 / - / 6.9 | 0 / - / 0 |
| R06 | @sentry/nextjs 8.48.0 -> 8.49.0 | stopped | - | - | - | 28 / - / 91.7 / 10 | 15 / - / 21.6 | 16 / - / 16 |
| R07 | @portkey-ai/gateway 1.13.0 -> 1.14.0 | built | 11 | yes | 1672.7 | 9 / 7 / 3606.3 / 2 | 11 / 4 / 995.6 | 1 / 1 / 1 |
| R08 | @intlify/core 9.14.4 -> 9.14.5 | stopped | - | - | - | 4 / - / 770.4 / 1 | 3 / - / 14 | 0 / - / 0 |
| R09 | snowflake-sdk 2.0.1 -> 2.0.2 | stopped | - | - | - | 47 / - / 41.3 / 45 | 89 / - / 51 | 20 / - / 18 |
| R10 | psitransfer 2.3.0 -> 2.3.1 | stopped | - | - | - | 7 / - / 129.2 / 5 | 3 / - / 1047.1 | 12 / - / 12 |
| R11 | @sentry/nestjs 8.48.0 -> 8.49.0 | stopped | - | - | - | 28 / - / 91.7 / 16 | 9 / - / 18.6 | 4 / - / 4 |
| R12 | multer 2.0.0 -> 2.0.1 | built | 2 | yes | 56578.8 | 4 / 3 / 31975.5 / 0 | 4 / 3 / 19624.1 | 0 / 0 / 0 |
| R13 | @vitejs/plugin-rsc 0.5.6 -> 0.5.7 | built | 1 | yes | 128.1 | 1 / 1 / 1838.6 / 1 | 1 / 0 / 128.1 | 0 / 0 / 0 |
| R14 | @finos/git-proxy 1.19.1 -> 1.19.2 | built | 4 | yes | 551.7 | 4 / 2 / 8752.9 / 2 | 4 / 2 / 261.3 | 22 / 22 / 22 |
| R15 | @node-saml/node-saml 5.0.1 -> 5.1.0 | built | 1 | yes | 2204 | 2 / 2 / 434.2 / 2 | 1 / 0 / 2204 | 2 / 2 / 2 |
| R16 | mcp-server-kubernetes 2.9.7 -> 2.9.8 | stopped | - | - | - | 1 / - / 8497.2 / 0 | 1 / - / 509.4 | 23 / - / 23 |
| R17 | @webrecorder/wabac 2.23.10 -> 2.23.11 | built | 1 | yes | 159.4 | 1 / 1 / 1392.3 / 1 | 1 / 0 / 159.4 | 2 / 2 / 2 |
| R18 | azle 0.29.0 -> 0.30.0 | no base | - | - | - | - | - | - |
| R19 | pbkdf2 3.1.2 -> 3.1.3 | built | 5 | yes | 144.2 | 30 / 27 / 1050.7 / 5 | 30 / 27 / 88.4 | 0 / 3 / 3 |
| R20 | glob 11.0.3 -> 11.1.0 | stopped | - | - | - | 3 / - / 1146.6 / 3 | 1 / - / 474.7 | 6 / - / 6 |
| R21 | next-auth 4.24.11 -> 4.24.12 | built | 0 | yes | - | 0 / 0 / - / 0 | 0 / 0 / - | 0 / 0 / 0 |
| R22 | @vitest/browser 3.0.3 -> 3.0.4 | stopped | - | - | - | 122 / - / 8.7 / 108 | 37 / - / 8.7 | 3 / - / 2 |
| T1 | braces 3.0.2 -> 3.0.3 (transitive) | built | 1 | yes | 1.2 | 1 / 0 / 21463.8 / 0 | 1 / 0 / 1.2 | 0 / 0 / 0 |

R18 has no base because azle 0.29.0's own tree needs a Git dependency, which the product's flags refuse.

Across the 13 built examples:

- **Oldest:** 40 versions moved, 0 not the oldest, 0 taken from the base's other paths.
- **The assert:** every version in every diff was published at or before T.
- **npm accepts them:** `npm ci --dry-run` exits 0, `npm ls` reports no new problem, and `npm install --package-lock-only` leaves each lockfile byte for byte the same.
- **Peers:** 0 `ERESOLVE`, 0 new problems.
- **Duplicates:** 3 new names with two versions, all in R19. Normal also has 3 there.
- **Install scripts:** 0 on the moved versions. **Engines not matching Node 24:** 0.
- **Normal against the oldest:** normal differs in 9 of the 11 examples that move a version, and normal at T in 5.
- **The checks can fail:** run on normal at T's lockfile, the same checks fail in those 5 (R04, R07, R12, R14, R19).
- **Normal's youngest version:** 8.7 hours, across all examples (R22, rollup 4.67.4, published 2026-11-01T07:48:35Z). In those 11 examples, normal took 19 versions that did not exist at T.

## Why 10 stop

| What was removed | Examples |
|---|---|
| The advisory filter alone stops them: they build without it | R02, R05, R08, R10, R16, R20, R22 |
| The deprecation filter also stops them: they stop without the advisory filter and build without both | R06, R09, R11 |

Two kinds, for instance:

- An exact sibling with an advisory today. R05 needs `@angular/core@20.3.0` and R16 `js-yaml@4.1.1`: one version in range, and it is named.
- A whole range excluded. R11 needs `@nestjs/core` at `^8.0.0 || ^9.0.0 || ^10.0.0`: 124 in range, 7 after T, 117 with an advisory. R09 needs `uuid@^9.0.1`: one version, deprecated.

Two limits on reading this:

- **Hindsight.** Advisories and deprecations are today's, not T's, and the advisory endpoint gives no dates. So some of these advisories were not known at T, and how many is not known. The true figure at T lies between the two ends below.
- **Not all hindsight.** A fix published today that needs `uuid@^9.0.1` would stop today. A rule with nothing allowed in range has no next version to take. The plan's risk table says to take the next oldest, which does not cover this case.

## The ends of the range, and the alternative

The two middle arms were added after the result and do not change the answer. All 23 lockfiles in the arm without either filter pass every check.

| Arm | Built | With a move | Stopped | Failed |
|---|---|---|---|---|
| The rule (the answer) | 13 | 11 | 10 | 0 |
| No advisory filter (diagnostic) | 20 | 18 | 3 | 0 |
| No advisory or deprecation filter (diagnostic) | 23 | 21 | 0 | 0 |
| The plan's alternative: resolve at T, 72h floor on every version but V | 17 | 15 | 0 | 6 |

In the arm without either filter, against normal at T, the oldest moves fewer versions in 7 examples, the same in 15, and more in 1. Moved versions, oldest / normal / normal at T, for those that differ: R22 10 / 122 / 37, R19 5 / 30 / 30, R06 10 / 28 / 15, R11 6 / 28 / 9, R12 2 / 4 / 4, R10 2 / 7 / 3, R02 1 / 6 / 3, and the one that moves more, R09 93 / 47 / 89. The oldest of a range can bring older dependencies that fail other ranges.

**The alternative** is npm's own flags (`--before=<T - 72h> --min-release-age-exclude=<name>`), and needs no replacement of npm's code. Its 6 failures are all `ETARGET`, at T: R01, R02, R03, R05, R08, T1. It filters no advisories, since npm only lowers a deprecated version's priority and does not look at advisories, so its 17 are not held to the same exclusion. It is therefore not a like-for-like comparison with the rule's 13.

## Wrong: the plan's guess that a just-published version is forced in under 1% of cases

Those same 6 examples are the ones in which V's own range forces a version under 72 hours old at T, in the arm without either filter (R01, R02, R03, R05, R08, T1 of 21 that move a version; 20 versions in all). In the rule's run, 3 of 11 (R01, R03, T1; 12 versions).

These examples were chosen for having a new or changed range, so this is not a population rate, but it is not under 1%. Backtest v4 points the same way: its same-release exception allowed sibling versions in 30 of its 200 fixes.

All 20 versions were published within 13.3 minutes of V, before or after it. So they make the wait start at about V's own time, and the rule cannot avoid them: no older allowed version satisfies the range.

## What this does not show

- Whether the oldest versions work. Gate 3 did not run, and no candidate code ran or was unpacked.
- Whether the rule stops malicious versions. That is the backtest's arm.
- A real project. Each base but C1 and T1 is one direct dependency taken when new, and T1 is the only transitive fix. R21 and C1 move nothing.
- Anything about the product: `packages/` is unchanged. Building this there would mean a script in the resolver's container that loads the pinned npm's internal modules by path and replaces one of their functions, and an update of npm would need this checked again.

## What it needs next

1. Advisories dated as of T, to place the true figure between 13 and 23. The backtests' OSV export has the dates, and this lane's limit on the network did not allow OSV.
2. The owner's decision on a range with nothing allowed in it. The rule as worded stops the fix, and the exposure goes on. The alternatives would be to allow an excluded version under some condition, or to notify and leave the fix to a person. Stops of this kind also count against C3.
