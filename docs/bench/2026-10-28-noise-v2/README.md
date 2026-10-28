# Noise rerun: gate 1's rebuilt production/dev split on the same 100 repositories (2026-10-28, cycle 3)

The first noise measurement (docs/bench/2026-10-28-noise) found 167 misses among the packages that the lockfile's `dev` flag left out. The owner's wording replaced the split: leave out only what can be shown dev-only; when in doubt, production. The definitions are in docs/decisions.md, "Gate 1's production/dev split, rebuilt; the noise rerun's definitions, fixed before running it". The count gate, the miss gate and the wait table are unchanged.

## When things were fixed, and what ran

| What | Commit | Time (JST) |
| --- | --- | --- |
| Definitions (one reading for (b), (c), (d) and CSS; the rerun; how first-run verdicts are reused), pushed before any implementation | 77f905a | 2026-10-28 20:45:11 |
| Source archives fetched and extracted (`scripts/sources.mjs`, 101 of 101, each on the first attempt) | ran before c381a85 | finished 20:54:18 |
| The split (`production.ts`), the lockfile reader's fix, `judge --source`, the tests, and the rerun scripts | c381a85 | 21:00:12 |
| **The rerun, first execution (the result)** | run at c381a85 | 21:00:33–21:15:41 |
| The reviewer brief | 02ecc2a | 21:01:24 |
| The output and the review assignments | 1a532c0 | 21:16:23 |
| The review: fresh-context subagents, with the brief as committed at 02ecc2a | verdicts committed with this README | started after 21:16:23 |

**How the rerun ran.**
- In Docker: node:24-slim@sha256:55fb5f5a…, npm 11.19.1, a read-only root, a non-root user, no forwarded environment, the sources read-only.
- `result/run.log`'s first line records the commit and the git blob hashes of `rerun.ts`, `production.ts`, `judge.ts`, `npm-facts.ts`, `time-cap.ts` and the first run's `noise.json` (semver 7.8.5). They equal `git ls-tree c381a85`.
- It ran once, and no repository failed. One repository needed a second attempt: Galane-dev/shesha-config-diff (row 91, `"attempts": 2`). `rerun.ts` retries on any error without logging it, so why its first attempt failed is not recorded. (#168's review found this; an earlier version of this README said no repository needed a second attempt.)
- One event during the run: at about 12:03Z, Claude Code stopped the docker client that streamed the run's output, because the host was low on memory. The container kept running, and `run.log` has every line from start to `done`. Nothing was restarted.
- `scripts/sources.mjs` ran from the working tree before it was committed in c381a85, and was not changed afterwards. Its first invocation stopped at once, before fetching anything, because the new volume's root was not writable by the non-root user (EACCES). The volume's owner was set, and the second invocation fetched all 101.

**What was read and fetched.**
- `package.json` and `package-lock.json` from raw.githubusercontent.com at each recorded SHA, as in the first run.
- Each repository's source from GitHub's archive of the recorded SHA, `node_modules` folders left out, extracted in Docker and never run. `sources-log.json` records each archive's SHA-256 and file count.
- npm audit received only the two files, with its own npmrc and scripts off. OSV received names and versions only.

## The sample

The first run's 100 repositories at their recorded SHAs, in the same order. No new search. JakeWharton/jakewharton.com, which the first run excluded because the lockfile reader refused it, was measured beside the sample: its lockfile now reads (npm audit 23, the judge 15, nothing left out).

**Which split each repository got:**
- 90: the source tree read, and no production Dockerfile's final stage holding devDependencies (D1 and D2);
- 9: a production Dockerfile's final stage holds devDependencies, so only D1 (staticdesigner/modevue, developer3000S/OmniRouteRus, datagrowth/sobre-abierto, KisaesDevLab/Vibe-MyBooks, ruddyribera-ops/pria-app, jadwalit-jpg/Jadwal, logicalgnosis/logicalgnosis.github.io, JDonoghue-UL/my-astro-blog, ELDIABLO2020/bannersin48);
- 1: the source tree incomplete, so only D1 (SteinOA/DSSA-Tale-Mac: `resources/legal/LICENSES.chromium.html` is over the 16 MiB read limit).

## Gate 1: the count (not met)

| | First run | Rerun |
| --- | --- | --- |
| npm audit's count (`metadata.vulnerabilities.total`) | 1,867 | 1,867 |
| The judge's production count | 560 | **938** |
| Gate: judge × 3 ≤ npm audit | 1,680 ≤ 1,867: met | **2,814 > 1,867: not met** |

**Shown, not gated:**
- npm audit's numbers did not change between the runs in any repository (total 1,867, `--omit=dev` 927, direct 1,087).
- The rebuilt split applied to the first run's own OSV results also gives 938, in every repository the same as the rerun. So the change from 560 to 938 comes from the split, not from the advisory databases.
- The judge against npm's directly vulnerable packages: 938 / 1,087 = 0.8629. Against npm's `--omit=dev` count: 938 / 927 = 1.0119.
- Per repository, the median ratio is 0.5269 (first run 0.2169). 30 of 100 repositories are at or below a third (first run 66). One repository has npm audit 0 and the judge 1 (counted as infinite, as before).
- The judge's count changed in 62 of the 100 repositories.

**Where the 378 more come from.** Of the first run's 538 left-out packages, 378 are now counted: all 65 of its "yes" verdicts, all 102 "undecidable", and 211 of its 371 "no". The other 160 are still left out. No package is newly left out.

## Gate 2: misses (not met)

**Result: 11 misses (11 yes, 0 undecidable) in 4 of the 100 repositories.**

**What was checked.** The rerun left out 160 packages in 57 repositories. Every one is left out because every installed copy of its vulnerable versions is dev-only by the split, and npm audit lists every one. All 160 were "no" in the first run, so section 5 sent every one to a reviewer to decide whether that "no" stands. None was a first-run "yes" (reused as "yes") or "undecidable", and none is newly left out.

**Who checked.**
- Five fresh-context subagents, not the worker, one per group of rows in sample order. They used the session's model. Because the host was low on memory, three started first and two more as earlier ones finished.
- Each got the brief committed before the review (02ecc2a) and the prompt in `review/reviewer-prompt.md`.
- Every reviewer finished every repository in its group, at the recorded SHA.
- `review/review-tally.json` (`scripts/tally.mjs`) adds the verdicts up. It changes none, and it found no missing verdict, no extra verdict and no inconsistent field.

| Group | Rows | Packages | First-run "no" reused | Yes | No | Undecidable | Misses |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1–25 | 33 | 30 | 0 | 33 | 0 | 0 |
| 2 | 26–43 | 32 | 28 | 2 | 30 | 0 | 2 |
| 3 | 45–65 | 37 | 29 | 2 | 35 | 0 | 2 |
| 4 | 66–86 | 40 | 34 | 6 | 34 | 0 | 6 |
| 5 | 87–98 | 18 | 16 | 1 | 17 | 0 | 1 |
| **All** | | **160** | **137** | **11** | **149** | **0** | **11** |

- Every package has an installed version in range.
- The 149 "no" verdicts: 137 first-run "no" verdicts reused, and 12 new "no" verdicts where a condition section 2 adds applied but the package was still shown dev-only. By rule: D1 89, D2 60.
- The 11 yes verdicts by rule: P1 9, P6 2.

**The 11 misses.** Each is a disagreement between the reviewer and the judge, reported here and not changed.

| Repository | Packages | Rule | The reviewer's evidence |
| --- | --- | --- | --- |
| BilLogic/uno-blueprint | body-parser, deepmerge, fast-uri, hono, ip-address, qs | P1 | `scripts/check-vendored-css.mjs` calls `require.resolve(UPSTREAM)` with `const UPSTREAM = 'shadcn/tailwind.css'`. That makes shadcn production, and following its dependencies reaches all six. |
| ASIL-E-Hatake/vscode-games | @azure/msal-node, qs | P1 | `scripts/test-package.ts:26–27` builds `node_modules/@vscode/vsce/vsce` with `join('node_modules', '@vscode', 'vsce', 'vsce')` and runs it. That makes @vscode/vsce production, and following reaches both. |
| acekyd/acekyd | sharp | P1 | `scripts/generate-og-cards.mjs:11–12` calls `require(process.env.SHARP_PATH \|\| 'sharp')`. |
| carlostighe/modalMap | cross-spawn, loader-utils | P6 | The build (`webpack … -p`) runs webpack's command-line launcher, which loads the installed webpack-cli. webpack-cli declares both. webpack lists webpack-cli only in `peerDependenciesMeta`, so following from webpack does not reach it. |

**What the misses have in common.** In every case, the code that reaches the package does not name it in the form the judge reads.
- In nine, the specifier is not a literal argument: a constant, an expression or a path joined from pieces. The judge reads only literal strings.
- In two, a tool loads another package at run time that it does not declare as a dependency, only as an optional peer.

All nine P1 cases are in `scripts/` files. The first rule did not count those as shipped code; section 2 counts them as source. For uno-blueprint and modalMap, the reviewers wrote that a stricter reading would make the verdict "undecidable" rather than "yes": still a miss. For vscode-games, the reviewer wrote that a reading limited to literal `node_modules/` text would make it a D2 "no", and counted it "yes" because when in doubt a package is production.

**Where reviewers read the rule differently.** Reported, not changed.
- **A tool that loads an undeclared package at run time.**
  - Group 2 counted webpack's launcher loading webpack-cli as P6, so modalMap's two packages are "yes".
  - Group 1 kept cofob/design-system's `fast-uri` "no". There, `astro check` loads @astrojs/check at run time, which astro does not declare, and P6 reads only the `astro` bin. Group 1 said this "no" holds only on the rule's wording.
  - Under group 2's reading, that `fast-uri` would be a miss too.
- **Command sources section 2 does not list.** Groups 1 and 5 kept these "no" and said so in the evidence:
  - badr-pdf's `tar`: a GitHub workflow builds the released APK with `capacitor-assets`;
  - cofob/design-system's `undici`: run only by a `deploy:showroom` script;
  - roughlogic's `undici`: `wrangler.jsonc` names `node_modules/wrangler/config-schema.json`, and a `.jsonc` file is neither source nor build tool configuration.
- **Whether an image holds devDependencies.** For ELDIABLO2020/bannersin48, group 3 could not tell whether a production stage holds devDependencies. It gave D1 "no" verdicts, which hold either way. The judge had found that `backend/Dockerfile`'s final stage holds them, and used D1 only for that repository.

**What this shows about the judge.**
- Under the rebuilt split, all 167 first-run misses are counted.
- The 11 misses the review found come from how the judge reads an import: it reads only literal string arguments. #168's review also found literal imports that the c381a85 reader missed; see "After #168's review" below.
- No miss came from a start script, a Dockerfile, a build tool's configuration, a bundler helper, a shipped runtime or a CSS import.
- The price is the count: 938 production findings against npm audit's 1,867.

## After #168's review: the reader fixed, and a second execution beside the result

#168's fresh-context review found eight places where c381a85's `production.ts` left out a copy that section 2 calls production. Examples: a code file named `dockerfile-snippets.ts` was skipped as source; a type-only match swallowed the next import; `import(/* comment */ 'x')` was not read; a heredoc `RUN npm ci` was not seen as a full install.

**The order of work.**
- The fix and the second execution were registered first (docs/decisions.md, 1fa3d68, 22:13:58 JST).
- The fixes went in 6c4f58e (22:18:43), with nine tests. Each test failed on c381a85's `production.ts` and passes on the fix (run in Docker: 9 failed and 25 passed on the old file; 34 passed on the new one).
- An automated security review then flagged an exponential backtracking pattern in the import-call reader. That was fixed in f0d489e (22:23:09), after the second execution had started. The fix changes how the patterns backtrack, not what they match. A test reads crafted inputs in linear time.

**The second execution**, reported beside the result and not instead of it:
- It ran at 6c4f58e, 13:19:00Z–13:35:02Z, with the same script, sample, sources and image.
- `result-fixed/run.log`'s blob hashes equal `git ls-tree 6c4f58e`. It ran detached (`docker run -d`), and it exited 0. No repository failed. One needed a second attempt (carlostighe/modalMap); the reason is not logged.
- During the run, the worktree volume it had mounted read-only was re-synced for the tests above. `rerun.ts` reads from that volume only at start (its code, the first run's `noise.json`, semver's version), so the run was not affected. Its logged hashes are the ones read at start.

| | The result (c381a85) | Second execution (6c4f58e) |
| --- | --- | --- |
| npm audit | 1,867 | 1,867 |
| The judge's count | 938 | 938 |
| Left out | 160 | 160 (the same 160) |
| Misses (from the review's verdicts) | 11 in 4 repositories | 11 in 4 repositories |
| Count gate | not met | not met |
| Miss gate | not met | not met |

- No row differs in its counts, its left-out list or which split it got.
- `scripts/beside.mjs` (`result-fixed/beside-tally.json`) counts the second execution's misses from the review's verdicts, as registered. It found that every package the second execution leaves out was reviewed, and that its left-out list is a subset of the result's: here, the same list.
- So none of the eight findings changed anything in this sample. They matter for repositories outside it.

## Both gates

| Gate | Result |
| --- | --- |
| The count: judge × 3 ≤ npm audit, over 100 repositories | **not met**: 2,814 > 1,867 |
| Misses: zero | **not met**: 11 misses (11 yes, 0 undecidable) in 4 repositories |

Both must hold, so the noise measurement **does not meet** the design's gate. Against the first run: misses 167 → 11 and repositories with a miss 32 → 4, while the count went from met (560) to not met (938). No definition is changed here. Whether to read non-literal requires, which would add some of these packages to the count, and how to bring the count down, are new decisions with a new run.

**One anomaly during the review: install scripts ran on the host.** Group 1's reviewer ran `npm ci` in this worktree by mistake (21:32:25–21:32:45 JST), on Ludion's own `package-lock.json`, through a host-side command it had built with `eval`. That broke the rule that project commands run only in Docker. Its report said npm skipped esbuild's and workerd's install scripts. That is wrong.

npm's own debug log (`npm-cache/_logs/2026-10-28T12_32_25_025Z-debug-0.log`, npm 11.17.0) shows:
- `info run esbuild@0.28.2 postinstall node_modules/esbuild node install.js` and `info run workerd@1.20261023.1 postinstall node_modules/workerd node install.js`, both ending `{ code: 0, signal: null }`. So both install scripts ran on the host.
- npm only warned afterwards that they are "not yet covered by allowScripts".
- Every tarball came from the local npm cache ("cache hit"). The only network request in the log is npm's bulk advisory query (`POST …/security/advisories/bulk`).

Also checked:
- No tracked file changed.
- `node_modules` is ignored by git, and the Docker checks use their own volume.
- Ludion's own package.json files declare no lifecycle scripts.
- No reviewed repository's code ran.

An earlier version of this README took the JavaScript shims left in esbuild's and workerd's bin folders as evidence that the scripts did not run. #168's review pointed out that esbuild's install.js leaves the shim in place on Windows, and npm's log then showed the scripts had run. The folder `node_modules` is still in the worktree.

## Files

- `scripts/sources.mjs`: fetches and extracts the source archives; `sources-log.json` is its log.
- `scripts/rerun.ts`: the rerun. `result/noise.json` holds every row (counts, the split each repository got, the left-out list with every installed copy and the judge's reason for each), the first run's numbers beside them, and the totals. `result/run.log` holds every printed line.
- `reviewer-brief.md`: committed before the review; quotes sections 1, 2 and 5 of the definitions.
- `scripts/assign.mjs` and `review/assignments.json`: which packages each reviewer got, with the first run's verdict and evidence.
- `review/reviewer-prompt.md`, `review/verdicts-N.json`, and `review/review-tally.json` (`scripts/tally.mjs`), which adds the verdicts up and changes none.
- `result-fixed/`: the second execution (`noise.json`, `run.log`) and `beside-tally.json` (`scripts/beside.mjs`).
