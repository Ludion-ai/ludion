# L1d: the misses fixed by cause, then both gates on a third sample of 100 (2026-10-29)

The owner's instruction of 2026-10-29 (B): the miss gate's definition stays, and the misses are fixed first. Lane L1d had four steps:
1. Classify the 58 misses of L1c's new 100 and the 11 of the original 100 by cause, package by package.
2. Fix them.
3. Register a third sample of 100 that overlaps neither earlier sample.
4. Measure.

The verdict comes from the third sample. Section 2 of the split's definition, "when in doubt, production", the gates and the wait table are unchanged.

## Result

| | Original 100 (reference) | Second 100 (reference) | **Third 100 (the verdict)** |
| --- | --- | --- | --- |
| npm audit (`metadata.vulnerabilities.total`) | 1,871 | 2,142 | **1,972** |
| The judge's production count | 950 | 1,062 | **1,021** |
| Count gate: judge × 3 ≤ npm audit | 2,850 > 1,871: not met | 3,186 > 2,142: not met | **3,063 > 1,972: not met** |
| To meet it, the judge would need at most | 623 | 714 | 657 |
| Misses (yes + undecidable) | 0 | 0 | **6 (5 yes, 1 undecidable) in 4 repositories: not met** |
| L1c's numbers for the same sample | 1,867 / 935, 11 misses | 2,136 / 998, 58 misses | (new) |

**Neither gate is met on the third sample, the sample the verdict comes from.** The 69 earlier misses are all counted now: 0 remain in either reference sample (`review/review-tally.json`, and `recount/recount-*-45079c2.json`: 11 of 11 and 58 of 58 counted). The third sample has 6 misses of causes the fix did not cover (below). Fixing misses raised the count, which was already 47–52% of npm audit's where the gate needs 33%.

## The steps, in commit order

| What | Commit | Time (JST, 2026-10-29) |
| --- | --- | --- |
| (1) The 69 misses, one row per package, with cause and basis (`classification.md`, `classification-table.md`, `classification.json`) | 9bb87fc | 09:56:04 |
| (2) The fix (production.ts and its tests) and docs/decisions/2026-10-29-l1d-fix.md, with the measurement scripts | cfbd159 | 10:06:32 |
| (3) The third sample's registration, docs/decisions/2026-10-29-l1d-third-sample.md, pushed before the search | 2692611 | 10:07:33 |
| The search (2026-10-25 UTC, 24 hours × 2 pages of 50, saved at 01:13:37Z; one HTTP 502 retried, `search/attempts.log`) | 63d7d2c | 10:13:47 |
| (4) The three measurements, first executions, at 2692611's code | run 01:14:43Z to 01:40:01Z | 10:14 to 10:40 |
| The reviewer brief | dd54a0d | 10:17:30 |
| The fresh-context code review's finding 1 (a `RangeError` on huge files), after the runs started | 45079c2 | 10:26:40 |
| The outputs, the overlap check and the review assignments | 78b40e9 | 10:40:54 |
| The miss review: six fresh-context reviewers, started after 78b40e9 | verdicts committed with this README | about 10:41 to 10:53 |

- Each `run.log` records commit 2692611 and the git blob hashes of measure.ts, sources.ts, production.ts, judge.ts, npm-facts.ts and time-cap.ts. They equal `git ls-tree 2692611`.
  - The runs read the search from the working tree at 63d7d2c, which adds only the saved search.
  - Each sample ran once. No repository failed, and no source needed a second attempt.
- In Docker: node:24-slim@sha256:55fb5f5a…, npm 11.19.1, a read-only root, a non-root user, no forwarded environment.
- **After the runs started, 45079c2** changed how specifiers are pushed (the review's finding 1). Recomputed beside the result at 45079c2's production.ts over each sample's own OSV results (`recount/recount-*-45079c2.json`): third 1,021, original 950, second 1,062, with **0 changed pairs** in each. So the merged code counts what the measured code counted.

## Step 1: the 69 misses by cause

| Cause | Misses | Fixed by |
| --- | --- | --- |
| A. GitHub's archive leaves out `export-ignore` files; the split read the partial tree as complete | 44 | a tree without a project folder's package.json is incomplete; the measurement marks an archive with `export-ignore` incomplete |
| B1/B2. webpack's bin hands off to webpack-cli, and webpack-cli to webpack-dev-server (names only in `peerDependenciesMeta`) | 8 + 6 | a package a command runs also runs what its `peerDependenciesMeta` names, recursively |
| B3. `webpack.config.ts` is loaded through ts-node | 1 | a TypeScript build configuration makes interpret's register hooks production |
| C1/C2/C3. A module named by a non-literal argument, an identifier's literal, or joined `node_modules` segments | 1 + 6 + 2 | the argument's literals, the identifier's same-file literal, joined segments |
| D. Umi's `config/config.ts` | 1 | `.umirc.*` and `config/config.*` are P2 files |

Every row is in `classification-table.md`. Each fix only makes more copies production (docs/decisions/2026-10-29-l1d-fix.md). The fresh-context code review confirmed this: monotonic against main, `reviewed-sha: 63d7d2c`.

**What the fix itself changes, on the same OSV results** (`recount/recount-*-main-5553d67.json`: main's production.ts over the same sources, which carry the measurement's new export-ignore markers):

| | main's split | L1d's split | Pairs added |
| --- | --- | --- | --- |
| Third | 1,009 | 1,021 | 12, all TurboWarp/packager (webpack hand-off) |
| Original | 937 | 950 | 13: the 11 misses, plus @hono/node-server and systeminformation in uno-blueprint (the same `require.resolve` of shadcn) |
| Second | 1,048 | 1,062 | 14: the 14 non-archive misses |

The second sample's other 44 misses (cause A) are counted by the measurement's source check, which applies to main's split too.

## The third sample

- **Overlap:** 0 repositories and 0 owners shared with the original 100 (with JakeWharton/jakewharton.com) or with the second 100 (`disjoint.json`).
- **Candidates:** 1,477 in the first run's order, of which 231 were considered to reach 100.
- **Exclusions by cause:**
  - no root lockfile: 82;
  - nothing named: 22;
  - fork: 18;
  - **in an earlier sample**: 4;
  - owner (a second repository of an owner already in): 3;
  - archived: 2.
- **Sources:** 100 archives fetched and extracted, each on the first attempt (`result-third/sources-log.json`).
  - Three set `export-ignore`, so only D1 applied to them: mustafaakalin/laravel-avukatlik-burosu, vilu85/toastr-ts and vistik/houston.
  - None has a `.gitmodules`. In the second sample, jbpratt/pi-experiments does; its tree lacks the submodules' contents, and that was not checked (review finding 6).
- **Splits:**
  - 87 with the source read and D2;
  - 9 with a production image holding devDependencies;
  - 4 incomplete: the three export-ignore archives, and OkayOkay101/BattleFightLegacy, where one file could not be read.

**Shown, not gated:**

| | Original | Second | Third |
| --- | --- | --- | --- |
| npm audit `--omit=dev` | 923 | 751 | 755 |
| npm's directly vulnerable packages | 1,090 | 1,272 | 1,200 |
| Judge / npm direct | 0.8716 | 0.8349 | 0.8508 |
| Judge / npm `--omit=dev` | 1.0293 | 1.4141 | 1.3523 |
| Per-repository median ratio | 0.5714 | 0.5200 | 0.5033 |
| Repositories at or below a third | 27 | 32 | 26 |
| npm audit 0, judge above 0 | 1 | 1 | 0 |
| Splits: read / image holding devDependencies / incomplete | 91 / 8 / 1 | 91 / 6 / 3 | 87 / 9 / 4 |

## The check for misses

The reviewers were six fresh-context subagents, given the brief committed at dd54a0d before they started (`reviewer-brief.md`, `review/reviewer-prompt.md`). The worker changed no verdict; `scripts/tally.mjs` adds them up (`review/review-tally.json`).

| | Checked | yes | undecidable | no | **Misses** |
| --- | --- | --- | --- | --- | --- |
| **Third 100** | 182 (all reviewed) | 5 | 1 | 176 | **6, in 4 repositories: not met** |
| Original 100 (reference) | 151 (150 earlier verdicts kept, 1 reviewed) | 0 | 0 | 151 | 0 |
| Second 100 (reference) | 218 (216 kept, 2 reviewed) | 0 | 0 | 218 | 0 |

**The third sample's 6 misses, by cause.** None was among the causes of step 1.
- **E. A build script that runs a package from inside a script file (4 "yes", P6).**
  - In haksanlulz/mcp-fairrent (node-forge, tmp) and shaqmughal/seekstone (node-forge, zod), `build:mcpb` runs `node scripts/build-mcpb.mjs`. That file calls `execSync("npx mcpb pack")` (and `npx @anthropic-ai/mcpb pack`), so the build runs @anthropic-ai/mcpb, and following its dependencies reaches these copies.
  - The split reads commands in package.json scripts, Dockerfiles and the listed command files, not the commands a script file runs. The reviewers note that a literal reading of P6 would make these "undecidable", which is a miss either way.
- **F. A logger transport named by a string (1 "yes", P5).** In ember-hearted/z-wiki (fast-copy), the server's `start` runs `node dist/index.js`. With NODE_ENV unset, `server/src/interaction.ts:100-108` gives Fastify's logger `transport: { target: 'pino-pretty' }`, so pino loads pino-pretty at start, and pino-pretty's dependencies reach fast-copy. A transport target is not an import under section 2. The reviewer decided by section 2's (d), "a start script counts whatever it runs".
- **G. A `node_modules` path in wrangler's configuration (1 "undecidable").** In hirthickramanath/Parallax (undici), three `wrangler.jsonc` files hold `"$schema": "../../node_modules/wrangler/config-schema.json"`. Section 2 counts "a `node_modules/<package>` path in … a build tool's configuration", but wrangler's configuration is not among P2's files, and `.jsonc` is not a source extension. The reviewer could not decide, so it counts as a miss.

**Reviewers' notes** (not counted as disagreements; each verdict's evidence records them):
- **Security: Joshuasco/coffeeShop (third sample).** The build (`node api.js && tsc -b && vite build`) runs `api.js`. After whitespace on its last line, that file hides an obfuscated payload: an XOR- and hex-encoded string table, passed `require`, which runs decoded code through a Function constructor. The reviewer did not run it. Its seven assigned packages are reached only through eslint (D1 "no"). The judge cannot say what such a payload loads.
- 2747025402/2fa-cfworkers has the same kind of `$schema` path as Parallax, in `wrangler.jsonc`, with a `deploy: wrangler deploy` script. That reviewer read it as not P2 and gave "no" (D2) for sharp, undici and ws. Under Parallax's "undecidable" reading, these three would be misses too. The verdicts stand as given; the two reviewers read the same text differently, and this is shown here.
- andressalame/profesormvt-web: wrangler runs only from a CI workflow (`npx wrangler deploy`), and section 2 lists no CI workflow.
- ftc-dev-tools and formula-manager-2: vsce and @electron/packager run only from `package`/`package:*` scripts, which P6 does not list.
- DavidOS: `vite.config.ts` holds `/// <reference types="vitest" />`, a quoted string that P2 reads as naming vitest.
- curarehab: a Directus Dockerfile runs a non-global `pnpm install` of two extensions; the reviewer relied on D1 only.
- Many "no" verdicts cite D1 where the judge recorded D2; same outcome.

## Files

- `classification.md`, `classification-table.md`, `classification.json`, `scripts/classify.mjs`: step 1.
- `scripts/sources.ts`: the source fetch with the export-ignore check. `scripts/measure.ts`: the measurement. `scripts/search.sh`, `scripts/join.mjs`, `search/`: the search.
- `result-third/`, `result-original/`, `result-second/`: `noise.json`, `run.log`, `sources-log.json`.
- `disjoint.json`, `scripts/disjoint.mjs`: the overlap check. `summary.json`, `scripts/summary.mjs`: the numbers above, read from the outputs.
- `recount/`, `scripts/recount.ts`: the split at 45079c2 and at main (5553d67), recomputed over each sample's own OSV results.
- `reviewer-brief.md`, `review/`: the brief, the prompt, the assignments, the verdicts and the tally (`scripts/assign.mjs`, `scripts/tally.mjs`).
