# Noise measurement: gate 1's production/dev split against npm audit (2026-10-28)

The design's gate 2 (ノイズ測定), with the weeks 1–2 gate "通知3分の1以下". The definitions are in docs/decisions.md:
- "Noise measurement: definitions fixed before running it", amended before the run (#155, six review rounds on the PR);
- "Noise measurement: one deviation during the search".

The wait table, the backtest gates and how unknowns are counted are unchanged.

## When things were fixed, and what ran

| What | Commit | Time (JST) |
| --- | --- | --- |
| Definitions and script, first push | d29b1e7 (#155) | 2026-10-28 17:14:06 |
| Last amendment before the run, merged | b394292 → 3418d55 (#155) | 17:38:31, merged 17:45:11 |
| The search (24 hours, pages of 50 after HTTP 502s) | 2ee1afc | search ended 17:55:14, pushed 17:55:34 |
| **The measurement, first execution (the result)** | run at 2ee1afc | 17:56:01–18:13:03 |
| The output committed | 3105fac | 18:13:32 |
| The review of left-out packages: five fresh-context subagents, with the brief as committed at 3418d55 | verdicts committed with this README | started after 18:13:32 |

**How the measurement ran.**
- In Docker: node:24-slim@sha256:55fb5f5a…, npm 11.19.1, a read-only root, a non-root user, no forwarded environment.
- `run.log`'s first line records the commit and the git blob hashes of `noise.ts`, `judge.ts`, `npm-facts.ts` and `time-cap.ts` (semver 7.8.5).
- It ran once. No repository needed a second attempt.

**What was read and fetched.**
- The search answers came from `gh api graphql`, run on the host with gh's own credentials. No token entered a container.
- `package.json` and `package-lock.json` came from raw.githubusercontent.com at each recorded SHA.
- npm audit received only those two files, with its own npmrc and scripts off.
- OSV received names and versions only.

## Sample

- **The search.** 24 hourly searches of 2026-10-27 found 1,364 distinct repositories (`search/`).
- **The order.** Round-robin by rank. 256 repositories were considered before 100 were included.
- **Excluded,** by cause:
  - no root lockfile: 114;
  - neither npm audit nor OSV names a package: 23;
  - fork: 10;
  - another repository of the same owner already included: 8;
  - **the judge's lockfile reader refused the lockfile: 1.** JakeWharton/jakewharton.com: "Unexpected package-lock path: node_modules/primitives/packages/ai-gateway". The judge cannot read that lockfile, so it would be undecidable there.
- **Lockfiles:** 95 v3, 5 v2.

## Gate 1: the count (met)

| | Sum over the 100 |
| --- | --- |
| npm audit's count (`metadata.vulnerabilities.total`) | 1,867 |
| The judge's production count | 560 |
| Gate: judge × 3 ≤ npm audit | 1,680 ≤ 1,867: **met** |

**Shown, not gated:**
- the judge against npm's directly vulnerable packages: 560 / 1,087 = 0.515;
- the judge against npm's `--omit=dev` count: 560 / 927 = 0.604;
- per repository, the median ratio is 0.2169 (one repository with npm audit 0 and the judge 1 counts as infinite);
- 66 of 100 repositories are at or below a third, and 34 are above.

**What the count does and does not show.**
- **Where the reduction comes from.** Against npm's printed total, the judge's count is below a third. Part of that comes from the unit: npm's total also counts packages that are flagged only because they depend on a vulnerable package. Against npm's own direct findings, or npm's `--omit=dev`, the judge's count is about a half to three fifths. The judge's split is the lockfile's `dev` flag, the same signal `--omit=dev` reads.
- **A pooled sum.** Five repositories have 73 to 117 npm findings each.
- **Lower priority, not silence.** Dev-only findings are still notified at lower priority (CLAUDE.md). So this is a count of production-priority findings.

## Gate 2: misses (the fresh-context review)

**Result: not met.** 167 misses in 32 of the 100 repositories.

**What was checked.** 538 packages the judge's count left out, in 83 of the 100 repositories; 17 have none.
- Every one is left out because every installed copy of its vulnerable versions is dev in the lockfile. npm audit also lists 534 of them.
- No package was left out because OSV lacked a record that npm audit had.

**Who checked.**
- Five fresh-context subagents, not the worker, one per group of rows in sample order. They used the session's model.
- Each got the brief committed before the review (`reviewer-brief.md`) and the prompt in `review/reviewer-prompt.md`. The brief quotes the registered rule verbatim.
- The sources came from GitHub's archive at each recorded SHA, extracted in Docker and never run. Each extracted tree's recorded SHA matched its row.
- The advisories were read from OSV and npm's GHSA ranges, and package code from the registry.
- Every reviewer finished every repository in its group.
- `review-tally.json` (`scripts/tally.mjs`) adds the verdicts up. It changes none, and it found no missing verdict, no extra verdict and no inconsistent field.

| Group | Rows | Packages | Yes | No | Undecidable | Misses |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1–25 | 108 | 14 | 94 | 0 | 14 |
| 2 | 26–49 | 114 | 4 | 92 | 18 | 22 |
| 3 | 50–72 | 107 | 15 | 83 | 9 | 24 |
| 4 | 73–88 | 102 | 23 | 62 | 17 | 40 |
| 5 | 89–100 | 107 | 9 | 40 | 58 | 67 |
| **All** | | **538** | **65** | **371** | **102** | **167** |

- Every package has an installed version in range: none has `in_range` "no".
- The 65 yes verdicts by criterion: (b) shipped code imports it or reaches it, 44; (c) the build puts its code in the output, 11; (d) a production command loads it, 10.
- The per-repository miss rate is 32 of 100, so the rule-of-three bound does not apply.

**Where the reviewers read the rule differently.** This is reported, not changed: the worker adds verdicts up and reports disagreements next to them (decisions, section 4). Each difference moves verdicts between yes, undecidable and no. Yes and undecidable both count as misses.

- **(b) "imports a package whose runtime dependencies reach it".**
  - Read as the imported package's declared dependencies, it makes everything under an imported framework production-relevant. Groups 1 to 4 applied it that way: SvelteKit's runtime (group 1), graphiql's markdown-it (group 2), vinext and `agents`' MCP SDK (group 3), and Nuxt (group 4).
  - Group 5 found it conflicts with "not production-relevant" when every path is build-only, and marked 58 such packages undecidable: Nuxt and @nuxt/content's build dependencies, Storybook's, astro's and @nx/next's.
- **(d) a `start` script that runs a development server.**
  - Group 1 applied (d) literally: `ng serve` (vite, piscina, fast-uri) and `nodemon` (semver), 4 yes.
  - Group 4 marked the 17 packages that Azure/api-management-developer-portal's `webpack-dev-server` start loads undecidable.
  - Groups 2 and 5 did not treat such a start as production where deployment files show production elsewhere. Group 2 marked modalMap's 3 undecidable, because that repository has no deployment files.
- **(c) helper code a bundler adds to the output.**
  - Groups 1 and 4 counted vite, esbuild or webpack yes where they confirmed in that version's code that its helper reaches the deployed output.
  - Group 3 marked such cases undecidable (5).
  - Group 2 required the build configuration to show it, and found none.
- **A CSS-only `@import "shadcn/tailwind.css"`.** The rule does not say whether a CSS-only import counts. Group 2 marked the packages that shadcn's dependencies reach undecidable (13). Group 4 marked them yes (9).

**Yes verdicts that rest on none of these readings,** as the reviewers' evidence states them:
- dompurify bundled into a deployed web asset (is-this-code-safe) and imported by a shipped frontend (Armor-test/uptime-kuma);
- an Electron runtime that the packaged app ships and runs (DSSA-Tale-Mac, PM-Shawn/Abu-Cowork, kkd927/kmux);
- esbuild loaded by `tsx` in a production image whose Dockerfile installs dev dependencies (KisaesDevLab/Vibe-MyBooks);
- markdown-it and linkify-it bundled for the browser through graphiql (enonic/app-explorer).

So the gate would not be met under any of the readings above.

**What this shows about the judge.** Gate 1's split is the lockfile's `dev` flag. It leaves out packages that a production build or runtime takes from devDependencies:
- front-end bundles;
- desktop apps that ship their runtime;
- servers started through dev-installed tools.

"Loaded in production" cannot be decided from the `dev` flag alone. No definition is changed here; deciding how gate 1 should judge this is a design question.

## Both gates

| Gate | Result |
| --- | --- |
| The count: judge × 3 ≤ npm audit, over 100 repositories | **met**: 1,680 ≤ 1,867 |
| Misses: zero | **not met**: 167 misses (65 yes, 102 undecidable) in 32 repositories |

Both must hold, so the noise measurement **does not meet** the design's gate.

## Files

- `search/`: the raw pages (`hour-HH.p1.json`, `.p2.json`), the joined files (`hour-HH.json`) and `attempts.log`.
- `noise.json`: every row with its counts, the left-out list (reasons, every installed copy, npm's ranges and nodes), the exclusions by cause, and the totals.
- `run.log`: every printed line, with the commit and hashes.
- `reviewer-brief.md`: committed before the review.
- `review/`: each reviewer's verdicts, and `review-tally.json`, which adds them up.
- `scripts/`: the search scripts, `join.mjs` and `tally.mjs`.
