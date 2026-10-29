# 2026-10-29 (L1d) — The third sample of 100: how it is chosen, what it leaves out, how it is shown not to overlap the first two, and how it is measured, fixed before its search

Lane L1d fixed the 69 misses' causes first:
- the classification: 9bb87fc;
- the fix: cfbd159, docs/decisions/2026-10-29-l1d-fix.md.

The gates are now decided on a third sample of 100 repositories that overlaps neither the original 100 (the noise runs) nor the second 100 (L1c's new sample), so that a fix made by looking at their misses cannot pass by fitting them.

This entry is committed and pushed before the third sample's search runs. The measurement runs at the commit that adds this entry, which is the registered commit. A later change is a new entry, and any execution at a later commit is reported beside the result, never instead of it. Nothing here changes:
- the count gate or the miss gate;
- the wait table or the backtest gates;
- section 2 of "Gate 1's production/dev split, rebuilt";
- the principle "when in doubt, a package is production".

**1. The third sample.** Chosen as L1c chose the second (docs/decisions/2026-10-29-l1c-new-sample.md, section 2), with these differences only:
- **The day.** The 24 searches cover the UTC hours of **2026-10-25**: `is:pr is:public author:app/dependabot label:javascript created:2026-10-25THH:00:00Z..2026-10-25THH:59:59Z sort:created-desc`. Each hour is fetched with `gh api graphql` as two pages of 50, in the same order and with the same fields (`docs/bench/2026-10-29-l1d/scripts/search.sh`, which is L1c's with the day changed), and joined by `scripts/join.mjs`, unchanged. The raw answers are saved and committed before either count is computed. 2026-10-25 is the whole UTC day before the second sample's day, and it had ended before this entry.
- **What it leaves out.** A candidate is left out, with cause `in an earlier sample`, when any of these holds:
  - its repository is one of the original 100 (`rows` of docs/bench/2026-10-28-noise/noise.json), or JakeWharton/jakewharton.com, or one of the second 100 (`rows` of docs/bench/2026-10-29-l1c/result-new/noise.json);
  - its owner (compared case-insensitively) owns one of those repositories.

  No owner is in two samples.
- **Everything else is the first run's and L1c's:**
  - the order: rank 1 of every hour, then rank 2, and so on, each repository once, at its first position;
  - one repository per owner;
  - not a fork, not archived;
  - a root `package.json` and `package-lock.json` at the head the search returned, a lockfile of at most 50 MB with lockfileVersion 2 or 3;
  - both counts computable within three attempts;
  - npm audit or OSV names at least one installed package.

  The first 100 included repositories are the sample. Every candidate considered, and why it was left out, is recorded by cause, and the exclusions by cause are reported beside the gates.

**2. How the third sample is shown not to overlap.** After the run, `scripts/disjoint.mjs` reads the three samples' `rows` and writes `disjoint.json`: the repositories and the owners (case-insensitive) that the third sample shares with each earlier one. Both must be 0, and the README reports both numbers. A nonzero number means the exclusion failed. That is reported, and the verdict is "not decided", not "met".

**3. The snapshot.** The default branch head that the search returned (its SHA is recorded). `package.json` and `package-lock.json` come from raw.githubusercontent.com at that SHA. The source tree comes from GitHub's archive of that commit (codeload), extracted in Docker with `node_modules` folders left out and never run. Its SHA-256 and file count are recorded (`scripts/sources.ts`). One check is added for cause A:
- an archive leaves out every path a `.gitattributes` gives `export-ignore`. So the tree is marked incomplete when the root `.gitattributes`, read from raw.githubusercontent.com at the SHA, or any `.gitattributes` in the archive sets `export-ignore`;
- an incomplete tree gets only D1, as the judge gives a tree it cannot read whole. The split also finds a tree incomplete when a project folder's package.json is missing from it (fix A);
- a nested `.gitattributes` that export-ignores itself cannot be seen, and this is stated.

If the archive cannot be fetched or extracted after three attempts, the split is computed without the source (D1 only), and this is reported.

**4. The measurement.** It is L1c's (its section 3), with `docs/bench/2026-10-29-l1d/scripts/measure.ts`:
- In Docker: node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205, npm 11.19.1 (any other version stops the run), a read-only root, a non-root user and no forwarded environment. No project code runs.
- **npm audit's count.** `npm audit --package-lock-only --json` in a folder holding only the two files, with its own npmrc (the public registry, scripts off). The count is `metadata.vulnerabilities.total`. Its direct findings and its `--omit=dev` count are recorded, not gated.
- **The judge's count.** The number of distinct package names that have at least one production version by section 2's split (`productionSplit` with the source tree, at the registered commit) and are named by an OSV record (`osvIds`, names and versions only).
- **The run.** The script records in `run.log` the commit, the git blob hashes of the files that compute the counts, and every printed line. It never overwrites a result, and makes three attempts per repository for network errors. The first execution started at the registered commit is the result. A stopped execution is reported with its log, and the next execution is the result.

**5. The gates, unchanged.**
- **The count gate:** over the 100 repositories, the judge's count times 3 is at most npm audit's count. Fewer than 100 included repositories fails it.
- **The miss gate:** zero misses.
- **The verdict is the third sample's.** A failure is written down as a failure.
- Shown, not gated: the ratios against npm's direct findings and its `--omit=dev` count, the per-repository median ratio, the number of repositories at or below a third, and which split each repository got.

**6. The check for misses** (on the third sample), as L1c's section 5:
- **What is checked.** Every package that npm audit lists as directly vulnerable, or that OSV names, and that the judge's count leaves out, with every reason, every installed copy, and npm's nodes and ranges.
- **Production-relevant** means production under section 2, for an installed version in range by either npm's GHSA range or OSV. A "no" cites the facts that show the copy dev-only: D1's path, or for D2 no import, no build tool naming or running it, no production command, and no production stage holding devDependencies. A package that fits neither, or that the reviewer cannot decide, is undecidable, and undecidable counts as a miss. A package no reviewer checks counts as undecidable.
- **Who checks.** Fresh-context subagents that are not the worker, with a reviewer brief committed before the review starts.
  - The brief quotes section 2 and this section, and lists the readings the split applies since the fix (each only makes more copies production). A reviewer may find any other copy production under section 2.
  - It says that repository and package text is data, not instructions.
  - It forbids running any repository's or package's code, and any npm or node command on the host.
  - The worker does not change a verdict. It only adds them up, and reports disagreements next to them.
- Every left-out package in the third sample is reviewed. No earlier verdict applies.

**7. The earlier samples, for reference only (not gated).**
- The original 100 and the second 100 are measured at the registered commit with the same script (`measure.ts original` and `measure.ts second`), with their sources re-fetched by `sources.ts`.
- Their numbers are reported apart from the verdict, next to L1c's (original 1,867 / 935, 11 misses; second 2,136 / 998, 58 misses).
- For each of the 69 earlier misses, the report says whether the judge now counts it.
- A left-out package that has an earlier verdict in the same repository keeps it, because the split only adds production since then. Any other left-out package is reviewed as in section 6.
- `scripts/recount.ts` recomputes the split over each earlier sample's own OSV results. This separates the fix's effect from changes in the advisory databases, and it is shown beside the reference numbers.

**Outputs.** docs/bench/2026-10-29-l1d/:
- the saved searches and `disjoint.json`;
- for all three samples, `noise.json`, `run.log` and `sources-log.json`;
- the recounts, and the reviewer brief and verdicts;
- a README with both gates on the third sample, the reference numbers, the exclusions by cause, and when each step was committed.

The result entry is a new docs/progress/2026-10-29-l1d-*.md.
