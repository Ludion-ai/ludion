# L1c: can the count gate pass without changing the definition? (2026-10-29)

The noise rerun's count gate was not met: the judge counted 938 production packages against npm audit's 1,867 (docs/bench/2026-10-28-noise-v2). L1c asked whether the split's *implementation* can meet the gate without changing section 2 of "Gate 1's production/dev split, rebuilt" or its principle "when in doubt, production":
1. Break the 938 down by the reading that was missing when the split could not decide.
2. Register a new sample of 100 repositories, and the measurement, before fixing anything.
3. Measure the fixed code on the original 100 and on the new 100. The gate is decided on the new 100.
4. Reduce only what can now be judged correctly.

## Result

| | Original 100 (rerun) | Original 100 (L1c) | **New 100 (the verdict)** |
| --- | --- | --- | --- |
| npm audit (`metadata.vulnerabilities.total`) | 1,867 | 1,867 | **2,136** |
| The judge's production count | 938 | 935 | **998** |
| Count gate: judge × 3 ≤ npm audit | 2,814 > 1,867: not met | 2,805 > 1,867: not met | **2,994 > 2,136: not met** |
| To meet it, the judge would need at most | 622 | 622 | 712 |
| Miss gate: zero misses | 11 misses (4 repositories): not met | 11 misses (4 repositories): not met | **58 misses (6 repositories): not met** |

**The count gate is not met on the new sample, the sample it is decided on.** Fixing what the split could not read changed the original 100 by 3 (938 → 935). The definition's own rules (following declared dependencies out of build tools, imports from build configuration, and so on; see docs/bench/2026-10-29-l1-count-breakdown) are where the count comes from. On the new sample the judge counts 47% of npm audit's total, where the gate needs 33%. Meeting it needs a change to the definition, which is the owner's decision.

## Step 1: what the split falls back on, among the 938

Each probe turns one fallback off and recomputes the split offline over the rerun's own lockfiles, sources and OSV results (`scripts/undecided.ts`, `result/undecided-main.json`). The pairs that drop are the ones that fallback alone made production.

| Reading the split falls back for | (repository, package) pairs | Where |
| --- | --- | --- |
| D1 only: a production image is read as holding devDependencies | **11** | developer3000S/OmniRouteRus 3, jadwalit-jpg/Jadwal 6, ruddyribera-ops/pria-app 2 |
| D1 only: the source tree is incomplete | 0 | (SteinOA/DSSA-Tale-Mac is D1 only, but every counted pair there has a P-rule) |
| A nested package.json that is not a lockfile folder (a separate project) | 1 | pria-app `server/` (zod) |
| An import no node_modules up the path resolves: every copy of the name is seeded | 0 | |
| A bin name seeding copies nested inside other packages (not on the PATH) | 0 | |
| Workspaces | not a fallback | Workspace folders are lockfile folders, read like the root. No code path falls back for them. |
| bundledDependencies | not a fallback | 20 counted pairs (1 repository) have only bundled vulnerable production copies. They are production by the same rules as any copy. |
| Following peerDependencies / optionalDependencies | 25 / 3 | These are section 2's "Following", not undecided cases. |

So at most 12 of the 938 were "could not decide, so production". **Fixed: 3 of them** (OmniRouteRus), where the image copies four package folders out of node_modules (`COPY --from=builder /app/node_modules/pino-pretty …`). The code read any source path containing `node_modules` as copying node_modules. Now one package's folder holds that package, and D2 applies to the rest. The other 9 stay production because the files cannot show them dev-only (docs/decisions/2026-10-29-l1c-fix.md, "Considered and not made"):
- pria-app's `server/Dockerfile`: its build context is not in the files;
- pria-app's `server/` lockfile: whether that folder is installed before its code runs is not shown;
- Jadwal's `npm install --prefix /tmp/sharpfix`: section 2's text counts it as an install.

## When things were fixed, and what ran

| What | Commit | Time (JST) |
| --- | --- | --- |
| Registration: the new sample and the measurement (`docs/decisions/2026-10-29-l1c-new-sample.md`) | b0b489a | 2026-10-29 02:50:17 |
| The fix, step 1's probe, the measurement and search scripts | 7891feb | 02:58:55 |
| The search (2026-10-26 UTC, 24 hours × 2 pages of 50), saved at 18:07:37Z | a8ba24d | 03:07:58 |
| Two fail-open cases from the automated security review, before any measurement (disclosed in the fix entry) | 0d441ea | 03:09:29 |
| **Both measurements, first executions (the result)**, at 0d441ea | run 18:09:59Z to 18:23:25Z (original) and 18:29:07Z (new) | 03:09:59 to 03:29:07 |
| The reviewer brief | b963f20 | 03:11:44 |
| The outputs and the review assignments | 47ad96e | 03:29:29 |
| The miss review: six fresh-context reviewers, started after 47ad96e | verdicts committed with this README | 03:29 to about 03:46 |
| Fixes after #190's fresh-context code reviews and the automated security review (toward production only) | c6c6f85, 224f5a3, 39061c0, 2b85143, 1fe1e0d | 03:25 to 03:46 |

- Both `run.log` files record commit 0d441ea and the git blob hashes of measure.ts, production.ts, judge.ts, npm-facts.ts and time-cap.ts. They equal `git ls-tree 0d441ea`. Each ran once. No repository failed, and none needed a second attempt.
- In Docker: node:24-slim@sha256:55fb5f5a…, npm 11.19.1, a read-only root, a non-root user, no forwarded environment. npm audit received only package.json and package-lock.json, and OSV only names and versions.
- **The code reviews' fixes came after the measurements started**, so 0d441ea's executions stay the result. Beside it (`beside/`, `scripts/beside.ts`), the split at each reviewed version of production.ts (the last: 1fe1e0d) was recomputed offline over each sample's own lockfiles, sources and OSV results. Original: 935, and new: 998, with **0 changed pairs** in either. 0d441ea's production.ts recomputed the same way also gives 998. So the merged code counts the same as the measured code on both samples.

## The new sample

- **The search:** 24 hourly searches of 2026-10-26 UTC (the day before the original's), 100 results each. Four pages answered HTTP 502 once and succeeded on retry (`search/attempts.log`).
- **Candidates:** 1,456 in the first run's order, of which 273 were considered to reach 100.
- **Exclusions by cause:**
  - no root lockfile: 134;
  - nothing named: 14;
  - fork: 12;
  - owner (a second repository of an owner already in): 6;
  - **in the original sample** (its repository or owner): 5;
  - archived: 1;
  - the judge's lockfile reader: 1 (keenanlk/stayput: `node_modules/@huggingface/transformers/stubs/empty` is not an install path).
- **Sources:** 115 archives fetched and extracted, each on the first attempt (`result-new/sources-log.json`). Every included repository had its source.
- **Splits:** 94 with the source read and D2. 6 with a production image holding devDependencies, so D1 only (joelmale/nexusVTT, W8SOJIB/W8OmniRouteTermux-Modedd, Brutusjam/projekt-status, monoscope-tech/monoscope, HillsboroLLC/jaspen, jonorl/fugazzeta).
- **One archive lacks the root lockfile:** eighteen73/pulsar-extensions, probably `export-ignore`. The measurement reads package.json and package-lock.json from raw.githubusercontent.com, so its counts are unaffected. The source tree it read was the archive's, which may leave out other `export-ignore` files; this also holds for the rerun's archives.

**Shown, not gated:**

| | Original 100 (L1c) | New 100 |
| --- | --- | --- |
| npm audit `--omit=dev` | 927 | 743 |
| npm's directly vulnerable packages | 1,087 | 1,268 |
| Judge / npm direct | 0.8602 | 0.7871 |
| Judge / npm `--omit=dev` | 1.0086 | 1.3432 |
| Per-repository median ratio | 0.5269 | 0.4808 |
| Repositories at or below a third | 30 | 36 |
| npm audit 0, judge above 0 | 1 | 1 |
| Splits: read / image holding devDependencies / incomplete | 91 / 8 / 1 | 94 / 6 / 0 |

The original 100's npm audit numbers equal the rerun's in every repository. Only OmniRouteRus's judge count changed (32 → 29).

## The check for misses

Fresh-context subagents, six groups, with the brief committed at b963f20 before they started (`review/reviewer-prompt.md`). The worker changed no verdict; `scripts/tally.mjs` adds them up (`review/review-tally.json`).

| | Checked | yes | undecidable | no | **Misses** | Repositories with a miss |
| --- | --- | --- | --- | --- | --- | --- |
| **New 100** | 278 (all reviewed) | 48 | 10 | 220 | **58: not met** | 6 |
| Original 100 | 163 (160 rerun verdicts kept, 3 reviewed) | 11 | 0 | 152 | **11: not met** | 4 |

- **Original 100.** The 3 newly left out (OmniRouteRus's brace-expansion, joi, shell-quote) are "no" (D2). The reviewer found the final stage copies only build output and four package folders. The 11 misses are the rerun's, unchanged (carlostighe/modalMap 2, ASIL-E-Hatake/vscode-games 2, BilLogic/uno-blueprint 6, acekyd/acekyd 1).
- **New 100, by cause:**
  - **eighteen73/pulsar-extensions: 44 "yes" (P5/P6).** Its `.gitattributes` export-ignores `/src`, `/package.json`, `/package-lock.json`, `/webpack.config.js`, `/postcss.config.js` and `/.*`, so GitHub's archive of the commit (27 files) has none of them. The split was handed that tree as complete and used D2, but its `start` and `build` run `wp-scripts`, which reaches all 44. **This is a gap in how the measurement gets the source** (an archive, not a checkout); the rerun's archives were made the same way. No original archive lacks its root manifest or lockfile. In the new sample, only this one does, and kulykovoleksii/board export-ignores only CHANGELOG.md.
  - **A tool the command reaches only indirectly: 4 "yes" and 7 "undecidable"** (opencast/studio, STRML/strml.net, timmson/agile-impact-map, ccnmtl/specialneedsvisit-pack). The cases are:
    - `webpack serve` in a `start` script, which runs webpack-dev-server;
    - `webpack`'s bin handing off to webpack-cli, which declares webpack-dev-server as a peer;
    - a `webpack.config.ts` that webpack-cli loads through ts-node.

    This is the class the rerun left open ("a tool that loads a package it does not declare").
  - **stop-bullshit/luckyh-cloud-web: 1 "undecidable".** Umi's `config/config.ts` names a plugin, but `config/config.ts` is not one of P2's file names.
- **Reviewers' notes, not counted as disagreements** (the verdicts stand as given):
  - cdk.json's `app` command;
  - nixpacks.toml installing without pruning (P5 lists nixpacks.toml for commands, but the holding test covers only Dockerfiles);
  - `execSync('pm2 …')` against a global pm2;
  - electron-builder run only from `dist*`/`pack` scripts.

  Each verdict's evidence records them.

## Files

- `scripts/undecided.ts`, `result/undecided-main.json`, `result/undecided-fixed.json`: step 1's probes.
- `scripts/search.sh`, `scripts/join.mjs`, `search/`: the new sample's search.
- `scripts/measure.ts`, `result-original/`, `result-new/`: the two measurements (`noise.json`, `run.log`; `sources-log.json` for the new sample).
- `scripts/beside.ts`, `beside/`: the reviewed code recomputed beside the result.
- `reviewer-brief.md`, `review/`: the brief, the prompt, the assignments, the verdicts and the tally (`scripts/assign.mjs`, `scripts/tally.mjs`).
