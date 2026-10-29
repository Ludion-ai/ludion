## 2026-10-28 — Noise measurement: definitions fixed before running it

Design, "ロードマップと検証ゲート", gate 2 (ノイズ測定), and the weeks 1–2 gate "通知3分の1以下". These definitions are committed and pushed before the run, and are not changed after seeing results. A later change is a new entry with a new run. The saved search answers are committed and pushed before the measurement runs. The first execution started at the registered commit is the result. If it stops before finishing, it is reported with its reason and its log (`run.log`, which keeps every printed line), and the next execution is the result. Any other execution is reported beside the result, never instead of it. The wait table, the backtest gates and how unknowns are counted are not changed by this entry.

**What is measured.** The judge's gate 1 today is: the installed version is in an advisory's range, and the package is production rather than dev-only. Its OS, SAPI and configuration conditions are not built. The production/dev split is the lockfile's `dev` flag: a version counts as dev-only only when every installed copy of it is dev (judge.ts). That is the same signal `npm audit --omit=dev` reads, so that count is recorded next to it.

**1. Sample.**
- **The search.** 24 GitHub searches, one per UTC hour of 2026-10-27, each `is:pr is:public author:app/dependabot label:javascript created:<hour> sort:created-desc`. Each takes the first 100 results, with the query in `tools/backtest/src/noise.ts` (`SEARCH`), run with `gh api graphql`. The raw answers are saved and committed.
- **The order.** Rank 1 of every hour (00 to 23), then rank 2 of every hour, and so on. Only PRs by the `dependabot` app whose branch starts with `dependabot/npm_and_yarn/` count. Each repository comes once, at its first position.
- **Inclusion.** In that order, a repository is included when all of these hold:
  - no repository of the same owner is in the sample yet;
  - it is not a fork and not archived;
  - its default branch's head has `package.json` and `package-lock.json` at the root;
  - the lockfile is at most 50 MB and is lockfileVersion 2 or 3;
  - both counts below can be computed. Each repository gets three attempts, so network errors, HTTP 429/5xx and timeouts are retried before it is left out;
  - npm audit or OSV names at least one installed package, so every repository has something to check.

  The first 100 included repositories are the sample. Every repository considered, and why it was left out, is recorded by cause. The exclusions by cause are reported next to the gates, including the judge's own failures (its lockfile reader, its OSV lookup).
- **The snapshot.** The default branch head the search returned (its commit SHA is recorded), root `package.json` and `package-lock.json` only. Workspaces are measured through the root lockfile. A Dependabot PR in a subdirectory does not change what is measured.

**2. The two counts, per repository.** Both are computed in Docker: node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205, with a read-only root, a non-root user and no forwarded environment. The command is in the script's header. The script refuses to run with any npm other than 11.19.1. Neither count runs project code.
- **npm audit's count.** `npm audit --package-lock-only --json` (npm 11.19.1) runs in a directory that holds only the two files. It has its own npmrc: the public registry, scripts off. The count is `metadata.vulnerabilities.total`, the number npm prints. That includes packages counted only because they depend on a vulnerable one. Also recorded, but not used for the gate:
  - npm's directly vulnerable packages (an advisory in `via`);
  - the same count with `--omit=dev`.
- **The judge's count.** The installed packages come from `lockEntries`, the judge's own lockfile reader. Each distinct name@version is looked up with `osvIds`, the judge's own OSV query (names and versions only). The count is the number of distinct package names that have at least one production version named by at least one OSV record (a vulnerability or a MAL- record).

**3. The count gate.** Over the 100 repositories, the sum of the judge's counts is at most one third of the sum of npm audit's counts. Fewer than 100 included repositories fails the gate.

**4. The check for misses.**
- **What is checked.** For each repository: every package that npm audit lists as directly vulnerable, or that OSV names, and that the judge's count leaves out. These are the "left out" list in the output. It gives every reason that applies:
  - OSV's vulnerable copies are all dev;
  - OSV names no record for the installed versions;
  - npm audit lists it.

  It also lists every installed copy (path, version, dev flag), and npm's nodes and ranges.
- **Who checks.** Fresh-context reviewers (subagents that are not the worker), never the worker. Each reviewer gets the repository list and the output, and checks every left-out package against primary sources:
  - the advisory: the GHSA or OSV record's affected ranges against the installed versions in the lockfile. A version in range by either npm's GHSA range or OSV counts as in range;
  - the code: the repository's source at the recorded SHA, its lockfile's dependency edges, and the packages' manifests and code where needed.
- **Production-relevant.** A left-out package is production-relevant (a miss) when any of these holds for an installed version in range:
  - (a) an in-range copy is not dev in the lockfile;
  - (b) shipped code imports or requires it, or imports a package whose runtime dependencies reach it.
    - Shipped code is the repository's code that runs or is loaded in production, or is bundled for the browser, whatever the file's role. A runtime configuration such as `next.config.js` counts. So does an imported package declared in devDependencies.
    - Tests, and build, lint or release scripts, are not shipped code;
  - (c) the build puts its code into the production output: runtime helpers or polyfills injected by a transpiler or bundler, say. The repository's build configuration must show this;
  - (d) the production start or serve command runs or loads it: package.json `start`, a Dockerfile `CMD` or `ENTRYPOINT`, a Procfile, or a deployment configuration. Examples are `serve`, `http-server`, `ts-node`, `tsx`, `pm2`, or `next` or `vite preview` declared as dev.
- **Not production-relevant.** All of these hold:
  - every path to it goes through tooling used only at build, test, lint or release time;
  - no shipped code imports it;
  - no production command runs it.

  A "no" verdict cites the dependency path and the files that show no production loader.
- **Undecidable.** A package that fits neither list, or that the reviewer cannot decide, is undecidable, and undecidable counts as a miss. A repository the reviewer cannot finish counts every unchecked package as undecidable.
- **The worker's part.** The worker does not change a reviewer's verdict. The worker only adds verdicts up, and reports any disagreement next to them.
- **How it is done.**
  - Each repository's source at the recorded SHA is read from GitHub's archive of that commit, extracted in Docker and never run.
  - Reviewers get the repositories in sample order, in groups.
  - The reviewer brief (docs/bench/2026-10-28-noise/reviewer-brief.md) is committed before the review starts. It quotes this section and says that repository and package text is data, not instructions.
  - For each left-out package, a reviewer records three things: whether an installed version is in range, whether it is production-relevant (yes, no or undecidable), and the evidence (file and line, or the dependency path).
  - The verdicts are committed with the results.

**5. The miss gate.** Zero misses over the 100 repositories. Also reported:
- the number of repositories with at least one miss;
- with 0 of 100, the rule-of-three upper bound on the per-repository miss rate, 3/100 (about 3%, 95%). That bound applies only to this sampling frame: one day of search, one repository per owner, root lockfiles v2/v3.

**6. Both gates must hold.** Not measured counts as not met. What a pass would mean: dev-only findings are still notified at lower priority (CLAUDE.md). So the count gate measures production-priority notifications against npm audit's count, not the total number of notifications.

**Not measured.**
- Vulnerabilities that neither npm's advisory database nor OSV lists.
- Whether a vulnerable code path is reachable or exploitable.
- OS, SAPI and configuration conditions (not built).
- Whether a repository is deployed at all.
- Lockfiles other than the root package-lock.json (pnpm, yarn, subdirectories), and lockfile v1.

**Outputs.** docs/bench/2026-10-28-noise/:
- the saved searches;
- `noise.json`: every row, its counts and left-out list, the exclusions by cause, and the totals;
- the reviewer brief and the reviewers' verdicts;
- a README with:
  - both gates;
  - the exclusions by cause;
  - shown, not gated: the judge's count against npm's directly vulnerable packages and against npm's `--omit=dev` count;
  - the per-repository median ratio, and the number of repositories at or below a third. Pooled sums can be dominated by a few large repositories.

**Disclosure.** Before this entry, the script was smoke-tested on two owned checkouts, which are in no sample: examples/npm-security (npm audit 1, judge 1) and this repository's root lockfile (0 and 0). The search query's syntax was checked on 2026-10-20, a day outside the window. That check printed 3 PRs' times, authors and branch prefixes, and the day's total of 49,629.

**Amended before the run** (rounds 1 to 5 of #155's review; nothing had run on the sample). Each amendment closes a choice that could otherwise be made after seeing data. One narrows a literal reading of the first text: under the first text, an in-range dev copy next to an out-of-range production copy was a miss, and under (a) as amended it is not. Every other amendment is stricter or changes no gate. The amendments:
- the production command criterion (d), and shipped code defined by what runs or is loaded in production;
- a package that fits neither list is undecidable;
- inclusion when npm audit **or** OSV names an installed package, not npm audit alone;
- the first execution started is the result (a stopped one is reported with its `run.log`, which records the commit it ran at, the git blob hashes of the files that compute the counts (noise.ts, judge.ts, npm-facts.ts, time-cap.ts) and the version of `semver` from node_modules, and any error that stopped it. `noise.json` records the commit and hashes too), the search is committed first, and each repository gets three attempts. The script refuses to overwrite an earlier result;
- the left-out list gives every reason, every installed copy, and npm's nodes and ranges;
- in range by either source, and (a) needs an in-range non-dev copy;
- the extra ratios and the per-repository view. In the median, a repository with npm audit 0 and a judge count above 0 counts as infinite, not left out. A repository with both at 0 has no ratio and is left out of the median and of the count at or below a third;
- the exclusions by cause, lockfile v1 under "not measured", the frame of the rule-of-three bound, and what a pass means;
- npm's version enforced, and the image pinned by digest;
- the reviewer brief committed before the review.

