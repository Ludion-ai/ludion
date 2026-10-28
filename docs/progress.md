# Progress

### 2026-10-25: v3 P1 Capability types, hashing, guard and receipt (no execution)

- Built: workspace `@ludion/capability` (zod ^4.6.5 only): Capability artifact/record schemas, canonical JSON (sorted keys, integers only, strings encoded as-is with no Unicode or newline normalization; file contents hashed as raw UTF-8 bytes), `cap:` sha256 ids, structural guard (`evaluateGuard` with an import-resolving tokenizer scanner, glob matching, `already_fixed`, static config), receipt validation, reuse/staleness checks and an execution gate that only runs `applicable`. Generated `capability.schema.json` / `receipt.schema.json` via `npm run gen:capability-schema`, with a staleness test. Code written by Grok CLI (grok-4.7, `--reasoning-effort xhigh`).
- Design decisions: lineage and counterexamples are outside the id hash (lineage on `CapabilityRecord`; counterexamples stale receipts via `counterexamples_hash`); Node patch differences stay reusable (major only); guard is structural only; schema rejects `effects.writes` overlapping `protected_paths`/`mount_at` with a conservative literal-prefix check and requires `protected_paths` to cover `mount_at` (fresh verifier mount after program execution is a P2 runner duty); receipts record `verifier_runtime {vitest_version, vitest_path}`. Added stale reasons `lockfile_changed`, `source_changed`, `runtime_changed`.
- Guard is an allowlist: it is `applicable` only for a direct `vi.<method>(...)` on a top-level `import { vi } from "vitest"` (no alias, no other declaration of `vi`, no `require`/`import()` of vitest), and reads config only from `export default defineConfig({ ... })` with an unaliased, never-reassigned `defineConfig` from `vitest/config` or `vite`, and an allowlist of keys: the root may contain only `test`, and `test` only `clearMocks`, `restoreMocks` and `mockReset`, each a boolean literal. Any other key (for example `plugins`, `resolve.alias`, `test.alias`, `setupFiles`, `globalSetup`, `extends`, `include`) makes the config `config_not_static`. Strings decode only the escapes `\\`, `\'`, `\"`, `\n` and `\t` (templates also `` \` `` and `\$`); any other escape is `parse_failed`. Import specifier names must be plain identifiers (`import { "x" as vi }` is `binding_unresolved`), and a tagged template such as `` vi`x` `` is a value use of `vi`. Everything else is `unknown`. Files read by a condition are capped at 64 KiB (65,536 bytes); a 64 KiB `x=>` or `(x)=>` chain scans in about 50 ms. Open: nested function-type parameters and `(a: A) =>` chains are still slower than linear, and there is no total time cap across files.
- Checked (2026-10-25 JST, Windows, Node 24.19.0): `npm run typecheck` exit 0, `npm run build` exit 0, `npx vitest run packages/capability` exit 0 with 10 files / 87 tests, `npm test` exit 0 with 37 files / 584 passed + 1 skipped (after merging main at 6e4c5e1, which adds the tools/verify tests from #127). The generated-schema staleness test passes. No diff against main under lessons/** or packages/core/src/generated/**. No Docker or program execution in P1.
- Review boundary: generated schemas are treated as protected, so `REVIEW_REQUIRED` (technical review, including the verifier boundary).
### 2026-10-15: Home composed for phones

- Built: phone-specific proportions for the visual opening, package selection, content-sized lesson inspector, native animated file delivery and recorded comparison controls. Short landscape shows the configuration comparison beside its metadata. The shared phone header wraps and exposes larger touch controls. Retained the independently merged desktop angle correction in #114.
- Preserved: exact package/model selection, unknown measurement handling, generated claims, teacher and agent-draft attribution, recorded answers, conditional wiring, scopes, partial coverage, privacy, URLs and motion termination. No dependency or protected path changed.
- Review: corrected actual enlarged-text overflow in chapter navigation and selection counts, enlarged small lesson targets/annotations, retained full selected values when native controls cannot wrap, and removed stretched landscape metadata rows that pushed attribution below the comparison. Fresh PR review additionally caught inherited version-label overlap and a clipped Context filename at enlarged text; corrected both and added glyph-bound/non-overlap assertions with a failing preceding-build receipt.
- Measured checks and source/capture receipts: `docs/site/2026-10-15-home-mobile.md` and `docs/bench/2026-10-15-home-mobile/validation.json`. Publication proceeds through its own unprotected PR, current-head green CI and deploy.yml; local checks alone do not establish publication.

### 2026-10-14: Less home copy, more graphic motion

- Built: actual-selection paper routes, animated configuration branching and finite Three.js context delivery. Repeated explanatory headings were deleted; literal claims and wiring moved into native disclosures. The approved opening, attribution, draft labels, evidence/date scopes, coverage, privacy and URLs remain.
- Review: compacted the mobile route and added readable flat delivery-mode labels. Expanded-state axe found a source link covered by the sticky chapter nav; changed the nav to static flow. Final independent source/image/live review found no remaining blockers.
- Integration: retained main's independently merged lesson retraction, notes and awaited-body budget fix. The first Linux CI failed on inactive-frame timeouts and a budget-body race; motion checks keep transient frame samples and fast-forward only terminal/idle intervals. Full local integration checks passed again, and the failed run remains in the receipt. Publication still requires current-head CI and live verification.
- Measured checks: `docs/site/2026-10-14-home-motion.md` and `docs/bench/2026-10-14-home-motion/validation.json`. Authorized publication proceeds through its own PR, green CI and deploy.yml. Local checks do not establish publication.

### 2026-10-14: Whole-home product interaction and authorized release

- Built: the approved visual opening now leads to operable version/model matching using the actual CLI selection, a signed lesson inspector, finite Three.js assistant delivery with exact conditional file wiring, the scoped recorded comparison and setup. Native chapter navigation, stable panels, no-JavaScript fallback, keyboard/focus and reduced-motion/offscreen handling remain. Existing URLs, generated claims, teacher and agent-draft attribution, privacy and partial coverage are preserved.
- Independent review: changed the initial model to make real pruning visible, varied the repeated card composition, made projected file names readable through flat labels, and stacked narrow selectors. A state accessibility sweep found a link target too close to the sticky navigation; enlarged it and added a mobile light/dark regression test.
- Validation and release evidence: `docs/site/2026-10-14-home-app.md` and `docs/bench/2026-10-14-home-app/validation.json`. Production publication is explicitly authorized; this change proceeds through PR #110, green CI and the repository's only deploy workflow. Local success alone does not establish that production has changed.

### 2026-10-14: Visual opening and recorded interaction on scroll

- Built: a visual opening with procedural flow, scroll-linked layer alignment and pointer depth; a second scene with a native recorded-answer switch/replay; a short setup closing. Removed the arbitrary central L. Supplied bracket logo used for the header/favicon. Actual comparison remains available on Bench too; existing lesson/setup URLs, scopes, attribution, partial coverage and privacy remain.
- Reviewed: actual Raycast/Linear openings and following scenes, plus independent source review. The first light-theme contrast check found a small red bracket at 4.07:1; darkened that text accent. Added keyboard focus retention through replay and an actual focus assertion. An earlier review caught the negative-base GLSL expression; its squared-offset fix remains.
- Validation: final-source checks recorded in `docs/site/2026-10-14-home-showcase.md`. This iteration is local and reviewable before the draft PR is marked ready.


What was built, what the check showed, what was decided and why. Newest first. Numbers come from `docs/bench/`.

### 2026-10-14: Site refinement and a recorded homepage comparison

- **Built:** smaller typography and a shared 1120 px content width across home, setup, lessons, subjects, teachers, Bench, model, recorded-answer, method and error pages. Home leads with the actual project command and a switchable pair of recorded answers from the existing Vitest demonstration. The synthetic checking replay is removed; generated claims, teacher/agent attribution, scopes, partial coverage, full answers and privacy disclosures remain. Setup leads with one command and the real sync flow, with native disclosures for detailed setup. The water reaches the page top while retaining its previous lower boundary. Short native page transitions and the comparison respect reduced motion. Decisions: "A quieter site, with a recorded result as its visual".
- **Responsive review:** retained main's independent fix in #108 for Bench groups, long identifiers, evidence captions/quotes and wrapped verification seals, including its all-page reflow tests. The refinement also gives narrow filters visible wrapped choices, uses compact seal padding at 320 px and recalculates wave bounds after fonts finish loading.
- **Checked locally after rebasing onto #108:** build (166 actual pages), typecheck, 456 unit tests; final full browser suite (23 passed, one optional screenshot test skipped, 1.9 min), including command-copy, keyboard-disclosure and stable comparison-height coverage. Actual-page axe checks pass in both themes; main-page checks cover 320–1280 px and main's page sweep covers 320, 390, 768 and 1024 px; animated-water contrast, both coverage edges and the raster-pixel budget pass. Home JavaScript is 4.1 KB gzipped against the existing 60 KB limit. Sample build (130 pages) and sample axe in both themes pass. An overloaded parallel run hit a worker test's 5 s timeout and the sample run's 30 s timeout; unchanged checks passed standalone. A stale dev-server manifest after rebuilding also returned a generated share-card 404; the final sweep uses a freshly started server and checks every share card successfully.
- **CI feedback:** the first draft's software-rendered animated background caused both axe sweeps to hit 405 s and the job to reach 15 min. Wave resolution now keeps the previous raster-pixel budget even across the taller canvas. Semantics/layout checks inspect the actual reduced-motion still frame; animated contrast and live motion checks remain separate. The local full suite completes in 1.9 min. This is a test-runtime measurement, not a real-device frame-rate claim.
- **Review boundary:** independent source reviews found no blockers. Local checks establish behavior and accessibility in Chromium; production deployment, real-device GPU performance and conversion improvement are not established by these checks.

## Done when (CLAUDE.md)

| | Check | State |
| - | - | - |
| 1 | Single player: a lesson taught in project A shows up via `ludion sync` in project B, and Claude Code in B gets right the task it got wrong before | **shown**: 1/5 before, 5/5 after sync, 3/3 through the plugin hook (`docs/bench/2026-10-11-done1/`) |
| 2 | Plumbing: `ludion teach --public` → merge → within five minutes `ludion sync` elsewhere writes it with the teacher's name, and `ludion_ask` returns it | **shown** (2026-10-13, `docs/bench/2026-10-13-done2/result.json`): #97 (vitest 4.0 `vi.restoreAllMocks`, `teach --public` by `Ludion-ai`) merged at 08:40:22 UTC; the site listed it after 67 s, `ludion sync` wrote it with `Taught by @Ludion-ai` after 74 s, `ludion_ask` returned it after 75 s (limit 300 s); one lesson, one run |
| 3 | Value: FreshBench on the wedge, Claude Code with default tools in a project with the new version installed, with vs without `ludion sync`: +20 points | B questions on the frozen seeds: **36/45 vs 24/45 (+27)** (`docs/bench/2026-10-11-done3/`). C tasks: running, one trial per task over several days |

## Current work: batch mode (from 2026-10-12)

The owner asked for the list below to be worked through in order without stopping for confirmation, with one report at the end. After a `/clear`, resume here: "docs/progress.md の続きから".

How the work runs:

- Every PR gets its tests and a fresh-context review (subagent). An unprotected PR is merged by us once CI is green.
- A protected PR (CLAUDE.md, `.github/`, `tools/verify/`, the schema, `lessons/`, `ludion.config.json`, `wrangler.jsonc`) is opened with its review posted as a comment and the `needs-owner` label, and the work moves on. Later work that depends on it is stacked on it.
- npm: one `publish.yml` stage at the end, once every CLI change is on main.
- Stop only for CLAUDE.md's "Stop and ask" items. Everything else is decided and written in `docs/decisions.md`.
- If the usage limit is hit, write here how far the work got, then stop.
- Every measured number goes in `docs/bench/`; no unmeasured number anywhere.

The list (status in brackets):

1. [done, #51] Replace the two seeds prepared in #50 (`DO_NOT_TRACK`, `--durable-objects-code-update-mode`), checked against primary sources.
2. [done, #53; issue form #54 waits for the owner] Say coverage is partial: `.ludion/lessons.md` and `ludion_ask` say Ludion holds some changes of some packages, that no lesson is no evidence of no change, and to check primary sources. Sync lists lockfile packages with no subject and one line on how to request one (issue URL with a template, label `subject-request`).
3. [built, branch `seed-pipeline`, no PR yet; yield numbers pending (next step 1)] `tools/seed`: package + version range → changelog, releases, source diff → drafted candidates → kind (with the "does code that doesn't use it behave differently" check) → differential tests → Docker → FreshBench `models` → harm check → one PR per subject labeled "drafted by an agent". Run it on the 30 existing seeds and compare (candidates, kept, review findings, in `docs/bench/`). Then a nightly workflow that watches covered subjects' new releases and opens PRs (protected).
4. [paused: 20 candidates scored and 3 chosen, zod/tailwindcss partly drafted, ai not started; next step 2 does one subject only] Two or more new subjects (target 6). Score 20 candidates on "AI writes it often" × release frequency × share of silent changes in the last 180 days; table in decisions. Each: FreshBench questions and keys from primary sources, seeds frozen, then B measurement and harm check. One seed PR per subject (protected).
5. [done, #55] Personal ledger: `ludion teach` accepts drafts without evidence, saved as `unverified`, shown in `lessons.md` as "unverified, yours only". `--public` still needs evidence.
6. [done, #63: no drop, no skill delivery] Experiment 3: 0, 50 and 500 correct but unrelated lessons, B accuracy. A drop of 10 points or more at 500 → build skill delivery (`.agents/skills/ludion-{subject}/SKILL.md`); otherwise don't, and say why.
7. [paused after 16 of 36 tasks (#61): daily batches stopped to save usage] C tasks: one batch a day (method in `docs/bench/2026-10-11-done3/README.md`). If C's gain is 10+ points below B's (+27), build the check hook (PostToolUse on Edit/Write matching imports and symbols against installed-version lessons) and measure it on part of C; otherwise don't, and say why.
8. [done, #93 merged 2026-10-13: README, 89-second demo, Show HN and X drafts, two letters; nothing posted or sent] Announcement tools: README (measured numbers only), an 89-second demo (`docs/demo/sync-vitest.cast`), one maintainer letter per subject, two so far (Cloudflare for wrangler and the Agents SDK together, and Vitest; each with a per-subject table of changes current models get wrong silently, asking whether they would pay for measurement), a Show HN post and one X post. The owner sends and posts them. More letters wait for the owner's discussion and for the subject to be measured.
9. [done, #57] Check that `llms.txt` and the per-lesson static pages are in a shape web search picks up.
10. [done, #100] License: the owner decided on 2026-10-13 that lessons are CC BY 4.0 (code stays Apache-2.0). `LICENSE-LESSONS`, the README, the CLI's README and the site footer say so; `teach --public` shows the teacher's sentence before its prompt and quotes it in the PR (in the next release of the CLI). #60 closed.

### Spending rules (2026-10-12, in force; details in `docs/decisions.md`, "Spending")

Heavy work one job at a time; Opus only for the review of protected PRs (one round); pipeline work on Sonnet; no per-lesson model FreshBench; no daily C batches; big files read through summaries; this file updated after each work item.

### What waits for the owner, in order (2026-10-13, latest)

1. ~~npmjs.com, `ludion-ai`: approve 0.1.4, reject 0.1.3.~~ **Done** (checked 2026-10-13): `latest` is 0.1.4, and 0.1.3 is deprecated ("Use 0.1.4 or later"). `npx ludion-ai@0.1.4 sync` in an empty folder against production exited 0 (`docs/bench/2026-10-13-done2/sync-production-0.1.4.txt`).
2. ~~Done 2, one line~~ **Done, passed** (2026-10-13): the owner ran `teach --public` from their own terminal (an agent's attempt stops at the confirmation, as designed), #97 merged; the three times and the three checks by hand are in `docs/bench/2026-10-13-done2/result.json`.
3. **Protected PRs, merge order** (2026-10-13): **#94** (retracts wrangler 4.113.0#10; users stop getting that lesson), then **#101** (Analytics Engine counting of `/index/*.json`; see 4), then Codex's **#69** (after its fixes; it will need a rebase over #100 and #101). #96 (`/bench`) was merged by the owner.
4. **After #101 is merged: the Worker secret.** `npx wrangler secret put ANALYTICS_SALT` with at least 32 random characters (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Until it is set the Worker counts nothing. If the deploy after the merge says Analytics Engine must be enabled for the account, enable it where the message says. What is stored, what the numbers mean and don't, and the SQL: `docs/bench/2026-10-13-index-counts/`.
5. **Next npm release, 0.1.5** (CLI + `plugin.json` + the hook's pin): carries the consent sentence (#100) and, when it lands, #69. I stage it with `publish.yml`; the owner approves it on npmjs.com (passkey). Until then `teach --public` shows no sentence. Whether to stage it now or wait for #69 is the owner's call; the default is to wait, to ask for one approval instead of two.

### Open PRs and what waits for whom (2026-10-13, after the owner's merges)

- **Merged by the owner on 2026-10-12 (UTC):** #62, #75, #76, #80, #84 (25 lessons), #73 (nightly seed watch), #54 (issue form). Production serves them since deploy run 38311678194 on `6dedffa`: `/index/subjects.json` lists agents 15, vitest 17, wrangler 23 active lessons. The deploys for the commits in between failed on purpose at "Make sure this is main's newest commit".
- **#73 drafts nothing yet**: it needs the `ANTHROPIC_API_KEY` repository secret (a secret value, the owner's). Without it, the nightly run lists new releases in its artifact and stops.
- **Waiting for Codex, then the owner's merge:** #67 and #68 were closed unmerged by Codex; **#69** is now the one open PR ("Harden sync privacy and benchmark verification", `needs-owner`). It touches the CLI, the Worker and the site strings, so it needs a rebase over #100 and #101.
- **After #69 is on main (this side):** rebase open work, bump the CLI to 0.1.5 with the plugin pin (0.1.3 was skipped and 0.1.4 carries the User-Agent), run `publish.yml` (the owner approves the staged version on npmjs.com), and dispatch `reverify` (lessons on main haven't run under #67's Docker flags).

### Who works on what (owner, 2026-10-12)

Codex: security, audits, the benchmark (`tools/bench`). Claude Code: the seed pipeline (`tools/seed`), lessons, the site, publishing. A change that needs the other side's files is raised with the owner before it starts. Main conversation on Sonnet; Opus only for the pipeline's reviewer and content reviser and for protected-PR reviews.

### Next (in order)

1. [done] Pipeline yield against the hand-made seeds (`docs/bench/2026-10-12-seed/README.md`).
2. [decided by the owner] Who revises: machine-check problems back to the drafting model (Sonnet) first; then the Opus review; lessons with content findings (rules 1, 7, 8) to Opus, the rest to Sonnet, one round (`docs/decisions.md`, "Revising seed drafts"). Built in `tools/seed` (`revise --scope check|findings`, review reuse for unchanged drafts).
3. [reviews done, see above] After the owner merges them: rebase this side's open work on main, bump the CLI (0.1.3 and 0.1.4 carry #53, #55 and the User-Agent and are staged; #67 is not in them, so it goes out as 0.1.5) with the plugin pin, and stage it with `publish.yml`.
4. [done] vitest and wrangler: the remaining drafts through step 2. No finding after it: vitest 5 of 23 reviewed (3 new, #80), wrangler 11 of 43 (8 new, #84); the rest repeat lessons on main. Counts and costs: `docs/bench/2026-10-12-seed/README.md`. Search questions: #82, #83. CI: #80 3 of 3; #84 8 of 8 after one `fix` round. Opus review of both (one round): #80 approve; #84 one lesson fixed (4.113.0#10 now says provisioning is generally available). Both wait for the owner's merge.
5. Not started: the three outreach letters for subjects not yet measured.

### Where the running work lives (for resuming)

- Worktrees: `C:/dev/ludion-wt-seed` (branch `seed-pipeline`: `tools/seed`, `.github/workflows/seed-watch.yml`, results in `docs/bench/2026-10-12-seed/` and `docs/bench/2026-10-12-subjects/`), `C:/dev/ludion-wt-exp3` (branch `exp3-unrelated`: `tools/bench/src/unrelated.ts`, CLI built from main at `e7d82d7`).
- Large caches outside the repo: `C:/dev/ludion-seedwork/` (unpacked packages, agent folders, logs `draft-silent.log`, `subjects20.log`, `c-batch-<date>.log`, the bench projects in `bench-projects/`, the day's C batch script `c-batch.sh <ids>`).
- The pipeline's steps resume from their files: rerun the same `node tools/seed/src/cli.ts <step> <dir>` command.
- C tasks: `bash C:/dev/ludion-seedwork/c-batch.sh <ids>` runs one day's tasks under both conditions (frozen seeds served from `C:/dev/ludion-freeze`); results land in `docs/bench/2026-10-11-done3/` of `C:/dev/ludion` and are committed in a docs PR.

## Log

### 2026-10-13 (evening): lessons are CC BY 4.0; Analytics Engine counting opened; #93 merged

- **License** (#100, merged): the owner decided CC BY 4.0 for lessons; I applied it to lessons only and kept code Apache-2.0 (a Creative Commons license is not for software; the decision named "the license" of lessons, which is what #60 was waiting on). Every lesson on main was taught by one account, so no one else's agreement was needed. `teach --public` prints the teacher's sentence before the prompt and quotes it in the PR; that is in the CLI on main and ships with the next release.
- **Analytics Engine** (**#101**, protected, `needs-owner`, Opus review below it): counts requests for `/index/*.json`; written only once the owner sets `ANALYTICS_SALT`. Three deviations from the request, each explained in `docs/decisions.md`, "Counting index requests": an HMAC under a secret instead of a public daily salt, the path as its own field instead of inside the hash, and "weekly" meaning client-days because the key rotates daily. `/start` and the README say what the server counts. No numbers yet.
- **#93 merged** after 0.1.4 reached npm. Nothing is posted or sent; the maintainer letters 03 to 05 are still set aside for the owner's discussion. #96 (`/bench`) was merged by the owner.
- **Codex**: #67 and #68 closed unmerged; #69 is the one open PR.

### 2026-10-14: The launch film

- **Built**: `video/` renders the 30-second launch film in 16:9, 9:16 and 1:1 (1080p-class, 60 fps, sound) with `node video/render.mjs`. Text and numbers are read from `docs/bench/2026-10-11-done3/`, `lessons/` and a new recording of `npx ludion-ai sync` (`video/recordings/`). Decisions: `docs/decisions.md`, "The launch film".
- **Checked**: frames and frame strips from each encoded MP4 in all three formats; the sound by spectrogram, loudness per half second and integrated loudness. No one has listened to it yet.
- **Waits for the owner**: where the MP4s are kept (they are not in Git) and whether the site's top embeds one.

### 2026-10-13 (night): UI bugs fixed, every page down to 320 px

- **Found** (the owner reported UI bugs; every page swept at 320, 390, 768, and 1280 px by a script that flags sideways scroll and any element wider than its box, `docs/site/2026-10-13-ui-fixes/sweep.mjs`, output in `sweep-before.txt`): on `/bench`, the subject headings of "Every lesson" sat in the version column, so "Haiku 5.5 Sonnet 5.5 Opus 5.5" ran over the first claim, and on a phone the rows were squeezed beside the heading with the version chip under the kind tag. On phones, long dotted names in claims widened the page (a lesson page was 433 px wide at 390), and at 320 px 59 pages scrolled sideways, with the large seal, source quotes, and one test caption among the causes. A second sweep after a phone-only first fix found a long flag too wide for a lesson's claim column at 1024 px, so the fix applies at every width. Decisions: `docs/decisions.md`, "Every page down to 320 px".
- **Checked**: the same sweep after the fix, at nine widths from 320 to 1600 px in light and dark (`sweep-after.txt`), finds nothing but the differential drawing's arrow, which sits in the gap between its two boxes on purpose. New e2e tests: no sideways scroll on any page at 320, 390, 768, and 1024 px; `/bench` subject headings span their rows with the model names over the marks. On main's build the sweep had found what each one checks for (pages up to 433 px wide on a 390 px screen; headings 104 px wide), and the heading test fails with the old selector put back. `npm test` (451) and `npm run test:e2e` (17, axe in light and dark included) pass. Screenshots before and after: `docs/site/2026-10-13-ui-fixes/`.

### 2026-10-13 (later): 0.1.4 is on npm; Done 2 passed

- **npm**: the owner approved 0.1.4 (`latest`) and 0.1.3 is deprecated ("Use 0.1.4 or later"). `npx ludion-ai@0.1.4 sync` in an empty folder against production exited 0 and wrote `.ludion/lessons.md` and `CLAUDE.md` (`docs/bench/2026-10-13-done2/sync-production-0.1.4.txt`). The `User-Agent` the CLI now sends was checked on the built CLI against a local server (#92); nothing in the Worker reads it yet.
- **Done 2: passed.** Taught by `Ludion-ai` with `ludion-ai@0.1.4 teach --public` (#97, opened 08:34 UTC), `verify` and `test` green, a fresh Opus review said APPROVE (comment on #97; it ran no lesson code), merged 08:40:22 UTC. From the merge, in seconds: `/index/vitest.json` lists the lesson at 67, `ludion sync` in a copy of the fixture project writes it with `Taught by @Ludion-ai` at 74 (second attempt), `ludion_ask` returns it at 75; the limit is 300. `author_id` is the PR account's id. The three checks by hand (sync in another folder, the teacher's name in `lessons.md`, `ludion_ask`) gave the same. One lesson, one run: the five minutes is shown for this path on this day, not a distribution.
- **A guard that worked**: run by an agent, `teach --public` stopped at "Teaching in public needs you at a terminal to confirm"; the owner ran the same line themselves. No way around it was tried.
- **A gotcha**: `npx ludion-ai@0.1.4 ...` started inside a checkout without `npm install` fails with "'ludion' is not recognized" (npx picks the workspace's own package); run it from another folder. Now in the Done 2 README.

### 2026-10-13: 0.1.4 staged; a lesson retracted; Done 2 prepared

- **npm**: 0.1.3 staged from #89, then the owner asked for a `User-Agent: ludion-ai/<version>` header in the same release; #89 had merged, so it went in #92 as 0.1.4, which is staged (run 38315009051, "has been staged with tag latest"). The built `dist/cli.js` was checked against a local server: it sent `UA=ludion-ai/0.1.4` on both index requests. Neither is approved yet; the owner approves 0.1.4 and rejects 0.1.3. After approval, `npx ludion-ai@0.1.4 sync` is run in a fresh folder against production and its output added here: not run yet.
- **Retraction**: a fresh Opus review of wrangler 4.113.0#10 (rewritten after #84's review and merged unreviewed) said DROP: a label removal that reads as a behavior change. The file is deleted in a protected PR (opened with the batch); the rule from it (a rewrite after the one review round is reviewed again) is in `docs/decisions.md`. One of 25 pipeline lessons retracted (`docs/bench/2026-10-12-seed/README.md`).
- **Done 2**: found on a draft PR that the required `test` check failed every lesson without search questions, which no teacher's PR can have: fixed in #91. Also found: vitest 4.0.0 needs vite 7.1.11 or older to run (`Unknown method: getBuiltins`), so the draft's tests pin it. CI's Docker run then passed both tests (`docs/bench/2026-10-13-done2/ci.json`). `measure.ts` was rehearsed on #80 and had two bugs, fixed.
- **Announcement materials** (#93, held until 0.1.4 is approved): README, 89-second demo (act 2 is a recorded `teach` and a `sync` elsewhere), Show HN and X drafts, one letter per subject (two so far). A fresh Sonnet check matched every number to `docs/bench/` and found wording problems (tools were read-only, not "default"; lessons frozen, not today's; seeds drafted from the same keys that grade), now fixed.

### 2026-10-13: `/bench`, FreshBench results for sharing

- **Built** (one PR, protected because it changes `.github/workflows/`): `/bench/` (the Done 3 table, a row per model and condition, each cell correct out of questions with its 95% Wilson interval; Haiku 5.5 and Sonnet 5.5 shown as not measured; the without-tools table and per-lesson verdicts from `/models/`), `/bench/<model>/` (questions it didn't get right, each with the change's lesson), 90 run pages with the session logs, `/bench/method/` (`docs/bench/README.md` plus a cost table), `/bench.json`, and a 1200×630 share card per model, screenshotted at build time. `/models` redirects to `/bench/`. Decisions: `docs/decisions.md`, "The bench page".
- **Checked**: every cell recounted from the grades files in a test, and the totals match the Done 3 README (24/45 without sync, 36/45 with); costs match the per-item `costUsd` sums ($5.27 and $5.79). `npm test` and `npm run test:e2e` pass locally, axe included in light and dark, with the new pages; the redirect answers 301; each card is a 1200×630 PNG. Pages looked at in a browser at 1280 and 390 wide, light and dark: on the phone the tables scroll sideways with the model column fixed, and the page itself doesn't (a hidden label inside the table had widened it; fixed).

### 2026-10-13: Water on every page

- **Built** (`apps/site`, `e2e`): the home page's water, generalized: `/bench`, `/lessons`, lesson pages, subject and teacher pages, `/start`, and the model pages each have a pool under a 2 px rule. Decisions: `docs/decisions.md`, "Water on every page".
- **Checked**: `npm test` (451), `npm run test:e2e` (15: axe in light and dark; the width test; and text contrast over the water on four pages in light and dark, lowest 5.3:1). Screenshots of each page's first screen, light and dark: `docs/site/2026-10-13-water/`.

### 2026-10-13: `/lessons` and the lesson pages redrawn

- **Built** (`apps/site` and an e2e test): claims set in parts, a two-column list row everywhere lessons are listed, `/lessons` with subject tiles, search, filters, and subject groups, and lesson pages with the models' verdicts and a differential test drawn as its versions. Decisions: `docs/decisions.md`, "The lesson pages, set like the bench".
- **Checked**: `npm test` (450, with `claim-parts.test.ts`: every claim on the site comes back word for word), `npm run test:e2e` (9: axe in light and dark on every page; no sideways scroll on `/bench/`, `/lessons/`, and a lesson page at nine widths from 360 to 1280), the sample build. Fixed on the way: `/lessons` was 416 px wide on a 390 px phone (a long claim), and the large seal was 6 px too wide at 360. Screenshots: `docs/site/2026-10-13-lessons/`.

### 2026-10-13: `/bench` laid out like the home page

- **Built** (`apps/site` only): a big statement and three linked figures up top, numbered sections with short captions, one models × lessons figure (cut by subject on phones), unmeasured models as empty tracks in Done 3, and the lesson list grouped by subject with marks for silent and agent drafts in place of repeated words. Decisions: `docs/decisions.md`, "The bench page, laid out like the home page".
- **Checked**: `npm test` (434), `npm run test:e2e` (8, axe in light and dark), the sample build; screenshots at 1280 and 390, light and dark (`docs/site/2026-10-13-bench-editorial/`), and at 1024 and 700; hover, click, and filters tried. The review found the page scrolling sideways between 761 and about 1010 px (the full figure can't shrink below 8 px squares), which no screenshot width had caught: the figure now picks its layout from its own width, and an e2e test checks nine widths from 360 to 1280.

### 2026-10-13: `/bench` redrawn: knowledge strips, bars, dates

- **Built** (on top of the `/bench` PR, `apps/site` only plus `docs/bench/release-dates.json`): a knowledge strip per model (a square per lesson: knows, doesn't, not measured), Done 3 as two bars with interval whiskers and the difference, the knowledge dates chart, the lesson list with filters, the method folded at the end, and share cards with only the strip and the count. Decisions: `docs/decisions.md`, "The bench page's look".
- **Measured** (from the files): without tools, Haiku 5.5 doesn't know 27 of 29 measured lessons, Sonnet 5.5 and Opus 5.5 28 of 29; 28 of the 57 active lessons aren't measured yet. In `release-dates.json`, every npm lesson's first version but one came out on Jul 21, 2026 or later, after the Jun 2026 cutoff Anthropic publishes for all three; the one before it is the taught `vi.restoreAllMocks` lesson (vitest 4.0.0, Oct 22, 2025), not measured yet.
- **Checked**: `npm test` (new `knowledge.test.ts`: squares recounted from models.json, dates matched to the file, cutoffs only with a source) and `npm run test:e2e` (axe in light and dark) pass locally; screenshots at 1280 and 390, light and dark; hover, click, and filters tried in a browser.

### 2026-10-12: Published as ludion-ai; the v2 stack is on main

- npm refused the name `ludion` ("too similar to luxon"), so the CLI is `ludion-ai` (two bins, `ludion` and `ludion-ai`). 0.1.0 was published by hand with the owner's passkey. 0.1.1 (sync keeps the lessons file when the index can't be fetched, 404 included) was staged by `publish.yml` through trusted publishing, with no npm token and with provenance, and the owner approved it on npmjs.com.
- The v2 PRs (#25 to #47) were merged into main one at a time, each deployed and checked by `check-production.ts`.

### 2026-10-11: Done 3 on the B questions; harm check

- Checked: the B questions on the seeds frozen at `7d61ed1`: **36/45 with sync, 24/45 without (+27 points)**, the official B result. Covered changes 16/30 → 28/30, uncovered 8/15 → 8/15.
- Harm check: of three losses with sync, one came from its own seed (`deploy` provisioning, which leaves out that the feature is generally available). That seed is withheld from #36. The other two changes have no seed.
- C tasks: the first attempt hit the plan's session limit after six tasks. The error rows were removed, not graded. From now on, one trial per task over several days, resuming where the last run stopped.
- Decided: a measurement on the frozen seeds is official, and one repeated after a seed changes is reference only. This replaces "discard and repeat", which would let seeds be tuned against the measuring questions.

### 2026-10-11: Seeds, the plugin, site pages, reverify (PRs open); how Done 3 is measured

- Built:
  - 30 seed lessons (#36), 29 with differential tests that passed in CI's Docker run.
  - The Claude Code plugin (#31).
  - Subject pages, `/start`, `/models`, tombstones and seed labels (#32).
  - The `>` in details, split out on request (#40).
  - Nightly reverify (#37).
  - Per-model FreshBench: Haiku, Sonnet and Opus, no tools, two trials each (`docs/bench/2026-10-11-models/`).
- Checked:
  - Realistic screening without lessons: 14/45 (`docs/bench/2026-10-11-realistic/`).
  - Done 1 shown (above).
  - Value preview: 34/45 with the seed drafts synced, but on the A questions, which the seeds came from. Seeds were rewritten after it, so it is reference only.
  - Fresh-context reviews of #32, #36, #37 and #40. Their findings are being fixed, and the seeds get every fix before their merge is requested.
- Decided ("Measuring Done 3" in `docs/decisions.md`): the official Done 3 freezes the seeds first. It measures on the B questions and on C tasks (coding tasks written from the answer keys alone, graded by rules on the files the agent leaves). A questions are never used again for Done 3. A measurement taken before a seed rewrite is discarded and repeated (replaced the same day: see the entry above).
- A misleading lesson is worse than none: in the preview, one seed's wording turned a right answer into a wrong one.

### 2026-10-11: The CLI, index shards, MCP v2 (PR open); single player, first attempt

- Built: `ludion sync` (lockfiles, shards, the ledger, model pruning, CLAUDE.md, AGENTS.md, and Cursor wiring, writes kept inside the project), `ludion teach` (checks, ledger, `--public` through `gh`), `/index/subjects.json` and `/index/<subject>.json`, the `ludion_ask` data line, and the new `ludion_teach`.
- Check: a vitest junit lesson taught in project A reached project B through `ludion sync`, and the agents read it. **Done 1 is not shown yet**, because the agent got the task right before the lesson too: it found the path by running vitest (5/5 before and after, `docs/bench/2026-10-11-single-player/`).
- Decided: pick Done 1 and Done 3 tasks by screening changes under realistic conditions (default tools, package installed). A change the agent can observe by running the project isn't where Ludion helps; silent changes it can't observe are.
- The WebdriverIO answer key was checked against vitest's docs: the provider is community-maintained, not removed. All 45 keys are being checked against primary sources.

### 2026-10-11: Lesson format 1 (PR open)

- Built: format 1 schema (structured fields, generated claim, grounded `detail`, `signal`, pinned and differential tests), the frozen format 0 schema for old lessons, `generateClaim`, the grounding and symbol checks in `verify`, and two-step Docker runs for tests that pin packages. The leftovers of #13 are gone.
- Check: 231 tests pass, including new ones for every field rule, the security guard on `symbol`, the differential label, and the runner's commands. Docker isn't installed on the machine that built it, so the first real run of a pinned test happens in CI with the first format 1 lesson.

### 2026-10-11: Switched to spec v2

- CLAUDE.md replaced by the v2 spec; `.claude/rules/` deleted; their standing details moved to `docs/decisions.md`.
- Closed #13 and #23; #19, #20, and #21 are folded into the v2 work (see `docs/decisions.md`).
- Before v2, measured on 2026-10-08: FreshBench v0 A questions, 7% correct with no tools and 47% with web search; vitest's ten B questions, 40% with web search and 100% with lesson drafts in the context (`docs/bench/2026-10-08/`). Caveat: one answer key (WebdriverIO, `vitest-5-0-0-6`) is known to be wrong, and it is in both the A and B sets, so the 7%/47% overall, vitest's A scores, and the ten B scores all include it. It is to be fixed against primary sources and the scores recomputed. Experiment 1: `ludion_ask` called in 20/20 runs (`docs/experiments/e1/`).

### 2026-10-12: Stopped at the usage limit (resume from here)

- `seed-pipeline` branch (pushed, no PR yet): `tools/seed` (collect, triage, draft, check, review, revise, lessons, ci, fix, bench, watch, score, questions, calibrate), `.github/workflows/seed-watch.yml` (to split into its own protected PR), bench projects for zod, tailwindcss, ai. Run data in `docs/bench/2026-10-12-seed/` (agents: drafted, checked, reviewed, revise round 1 partly done; vitest and wrangler drafts partly done) and `docs/bench/2026-10-12-subjects/` (20 candidates triaged and scored; new subjects chosen: ai, tailwindcss, zod; their drafting just started).
- Reviewer calibration on the 30 accepted seeds: `docs/bench/2026-10-12-seed/calibrate-hand-seeds.json`. Some findings may be real problems in lessons on main (rules 3 and 8); read them.
- `exp3-unrelated` branch: harness and pool committed; the run was stopped early. Rerun `bash C:/dev/ludion-seedwork/exp3.sh` (it resumes per condition only when a condition's answers file is missing; delete a partial one first).
- Background drafting was killed; the pipeline resumes from its files, but delete any `drafts/*.json` record whose `error` mentions a limit before rerunning `draft`.
- Open: #54 (issue form, needs owner), #59, #60, #62 (C batch). Outreach drafts are in worktree `C:/dev/ludion-wt-outreach` (branch `outreach`, not pushed).
- Next: finish drafts → check → review/revise → lessons → one PR per subject (needs-owner) → ci/fix → bench; summary numbers into `docs/bench/2026-10-12-seed/README.md`; experiment 3; C batch day 2; npm stage last.

### 2026-10-12 (later): stopped at the usage limit again; resume here

- Done since the last note: spending rules (PR "Write the spending rules and the next steps"), pipeline defaults to Sonnet, duplicate check against lessons on main (`lessons` step writes `duplicates.json`), new-subject drafting stopped (zod 25 and tailwindcss 15 drafted, ai none; kept in `docs/bench/2026-10-12-subjects/`), vitest reviewed once (round 0: 34 drafts, 24 passed the local checks, 54 review findings; no further rounds, per the rules).
- wrangler drafting: 31 drafted and 1 skipped saved; 24 runs ended on the usage limit and their error records were removed. Resume: `node tools/seed/src/cli.ts draft docs/bench/2026-10-12-seed/wrangler --kinds default,behavior,deprecated,renamed,removed --signal silent`, then `check`, `review`, `lessons` (one round of `revise` at most) and `summary` on that folder.
- Next step 1 is still open: write `docs/bench/2026-10-12-seed/README.md` comparing candidates → passed local checks → review findings → CI for agents (summary.json exists; PR #62 is the CI run, 6 of 6 passed Docker), vitest and wrangler, against the hand-made seeds (`calibrate-hand-seeds.json`: 46 findings on 30 accepted lessons; reviewer was Opus there). Models differed across runs (agents and vitest Opus, wrangler partly Sonnet); say so in the README.
- Open PRs: #54 (issue form, owner), #60 (consent draft), #62 (6 agents lessons, owner; test re-run on the merged branch is pending in CI), #66 (outreach, auto-merge), the spending-rules docs PR (auto-merge). `seed-pipeline` has no PR yet.


## 2026-10-27 — Security-update source preview

Repurposed the active home/setup copy using the existing visual system. Added init/scan/patch/watch for exact-version, single-stage official PHP images, with official same-branch security-release lookup, offline baseline/candidate validation, digest pinning, source-change and policy-change checks, local evidence and opt-in Dockerfile application. Reused the capability timeout runner and central Docker argv builder; legacy client/data/MCP compatibility remains. Archived old product documentation and updated current engineering direction.

Validation: typecheck, workspace and sample builds; 666 tests passed / 7 skipped, security adapter 25 passed, browser 29 passed / 2 skipped, screenshot capture 36 PNGs. Real Docker success, validation-only, intentional candidate failure and intentional baseline failure behaved as specified; failure cases left source unchanged. Dependency audit went from 14 findings to 0 after compatible remediation. Evidence: docs/bench/2026-10-27-security-pivot/. No production deployment or npm publish. Remote CI and protected-file independent review pending.


### Security preview — independent review corrections

The independent reviewer reproduced a stale validated result in validation-only mode and a missed empty-directory source change, and found watch stop did not cancel pending apply. Fixed all three: freshness check for both modes, directory identities/modes plus preserved copy modes, and cancellation gates after async work and before apply. Stop latency is explicitly documented: a running Docker step may finish, but pending application is cancelled. Added regressions. Final local results: 673 passed / 8 skipped overall, security 32 passed / 1 Windows mode skip, all 31 browser checks passed with screenshot capture enabled, 36 refreshed PNGs, and all four real Docker scenarios rerun successfully. Prior remote CI also passed; new-head CI and final protected-file review remain gates.


## 2026-10-27 — npm, Composer and Maven security updates

Expanded the existing PHP source preview with shared OSV detection, supported inventory discovery, constrained manifest-only acquisition, offline baseline/candidate application validation and source-file application for npm, Composer and standalone Maven. Included direct and transitive dependencies, native same-major resolution, candidate advisory rechecks, multi-file recovery journals, stale-source/policy and cancellation gates. Existing UI now shows all four supported ecosystems and explicit limitations; legacy integrations remain. Removed the obsolete production Chromium install; PR browser tests stay.

Real copied-fixture runs all applied successfully: lodash 4.17.20→4.18.1 (5→0 known matches), symfony/http-foundation 5.4.0→5.4.54 (2→0), commons-text 1.9→1.10.0 and transitive commons-lang3 3.11→3.18.0 (2→0). Both baseline and candidate application smoke tests passed. Observed warm-cache times were 24–40 seconds; not a benchmark or exploit regression. Integration failures in npm cache ownership and Composer CLI compatibility were fixed without weakening blocking behavior.

Local verification: typecheck, workspace and sample builds pass; 714 tests passed / 8 skipped; all 31 browser checks passed with 36 screenshots, zero axe violations, mobile/200%-text/reduced-motion checks and 32.1 KB gzipped home JS. npm audit: 0 findings. Evidence: docs/bench/2026-10-27-security-expansion/. Independent exact-head review, GitHub CI and owner merge approval remain release gates. npm publication and customer production deployment are outside this change.

## 2026-10-27 — Design adopted; legacy frozen

`docs/design.md` (security fixes applied automatically, npm first) is the plan from here. `security/multi-ecosystem` was only on one machine; it is now pushed. Main at `3bd1de1` is frozen as the tag `archive/lessons-2026-10-27`, so the cleanup's deletions can be undone from it.

Local check of this branch at `0d7fdbb` (Windows, Node 24.19): typecheck and build pass; vitest 714 passed / 8 skipped.

## 2026-10-27 — Security Docker runner extracted

Added `packages/cli/src/security/docker.ts` and switched `patch.ts` to it; the generated test argv is identical to the previous security phase of `buildDockerRunArgs`. New unit tests cover the exact argv, refusal of unsafe names, tags instead of image IDs and flag-like or empty test argv, the image-command allowlist, exit/output handling, name-only kill on timeout, spawn errors and the output cap. The `docker run` guard was tightened to explicit builder files and functions; a deliberate run argv outside `runArgs` was confirmed to fail it, then removed.

Results: typecheck passed; 680 passed / 8 skipped. The CLI bundle went from 2,455,228 to 1,675,049 bytes because it no longer pulls in the capability schema and guard. Real Docker, validation only, on a temporary copy of `examples/php-security`: PHP 8.4.26-cli-alpine → 8.4.27-cli-alpine, baseline and candidate passed, outcome `validated`, Dockerfile hash unchanged, temporary images removed. No deployment or npm publish.

### Security Docker runner — independent review, round 1

Verdict REQUEST CHANGES, with one blocking finding: the sandbox flags had moved out of the protected paths, and the protected guard trusted the new, unprotected file. Fixed by making `packages/cli/src/security/docker.ts` a protected path. Also fixed from the non-blocking findings:
- `runContainer` now builds its own hardened argv.
- A spawn that throws with an empty message now reports `Error` instead of an empty string.
- `runDockerImageCommand` has unit tests for success, failure, timeout and a missing Docker.
- The guard ends a builder function at its closing brace and flags `exec docker run` and non-kill/pull/version literal argv inside builder files.

Kept, with the reason: the now-unused security branch of `buildDockerRunArgs` in `tools/verify` (in-flight branches still call it; it goes when `tools/verify` is deleted), and this file's existing double-blank-line spacing.

## 2026-10-28 — `packages/sandbox` (cleanup PR-B)

Moved the security Docker runner, the public-address fetch and the container-start guard into `packages/sandbox`; `dependency-patch.ts` now runs its tests through `runContainer`, like `patch.ts`, passing its tool. New tests: the exact argv for each tool, refusal of an unknown tool before anything starts, and `runContainer` passing only the tool through.

Local, Windows, Node 24.19, Docker 29.9.2: typecheck and build pass; vitest 727 passed / 8 skipped. Real Docker, validation only (no `--apply`), on temporary copies of the examples with the built CLI: `php-security` 8.4.26 → 8.4.27, baseline and candidate passed, `validated` (10 s); `npm-security` lodash 4.17.20 → 4.18.0, known matches 5 → 0, baseline and candidate passed through the npm tool flags, `validated` (23 s). Application smoke tests, not exploit regressions.

## 2026-10-28 — Legacy deleted (cleanup PR-C)

About 2,900 files removed, docs from 65 MB to the security evidence only. CLI bundle 1,956,307 → 373,363 bytes. Checks, local, Windows, Node 24.19: typecheck pass; build pass; vitest 179 passed / 1 skipped; Playwright + axe on every page, light and dark, mobile reflow and contrast: 30 passed / 1 skipped (port 8797, so another session's dev server could not answer). Built CLI: `ludion sync` prints that it ended (exit 2); real Docker, validation only, temporary copy of `examples/php-security`: 8.4.26 → 8.4.27 `validated`. Worker: 410 `ended` on `/index.json`, `/index/*`, `/mcp`; `/@ludion-ai` and old lesson URLs 301 to `/start/`.

## 2026-10-28 — CLAUDE.md rewritten (cleanup PR-D)

CLAUDE.md, README wording ("An empty result is not a security guarantee", from #138's review) and the last lesson-era site copy. Local: typecheck pass; build pass; vitest 179 passed / 1 skipped; Playwright + axe 30 passed / 1 skipped.

Round 1 review of this PR (REQUEST CHANGES): CLAUDE.md read design targets as current behaviour. It now states the goal as a goal and lists what is not built yet (gate 2, waits, lockfile-diff checks, minimal candidates, exposure timestamps, apply setting), with the rule not to describe the preview as gated, waited or minimal until each lands; plus the reviewer's non-blocking clarifications. Also added from #140's review: the decisions note on which six files' final versions are only in main's history, a production check of `/index/subjects.json`, and a container-start guard that scans every `.ts/.mts/.cts/.js/.mjs/.cjs` file in the repository except unit-test folders, build output and installed packages.

## 2026-10-28 (cycle 2) — CLAUDE.md's built list updated

Only CLAUDE.md's built and not-built paragraph changed (decisions: "CLAUDE.md's built and not-built list catches up"). Each added fact was checked against main at 3e2e350:

- `time-cap.ts`: `timeCap` and `sameRelease`, with its 15 minutes;
- `dependency-patch.ts`: `candidateTimeCap` for npm and Composer, with the exception's facts read for npm only;
- `osv.ts`: Packagist's advisories in Composer planning;
- docs/bench/2026-10-28-backtest-v4: 1 missed at every wait, and 157, 157, 95 and 76 unknown.

Since 3e2e350, main has merged #154 and #155. Neither changed `packages/`, `apps/` or CLAUDE.md.

No code changed. No test reads CLAUDE.md, so none was run.

The first review (fresh context) asked for changes, with two blocking findings: the judge v0 overstated as all of gate 2, and Composer's release dates. Both are fixed (decisions: the same entry). Also checked: `judge.ts` lists the code inspection under "not checked", `time-cap.ts` skips the targets and reads Packagist's `time`, and `dependency-patch.ts` re-scans the candidate for advisories.

The second review asked for changes too, with one blocking finding: "the waits" included a project's own stricter wait. Checked: `projectWait` appears only in `judge.ts`; `judge-cli.ts` does not pass it. Also checked: `osv.ts` keeps every ID OSV returns, MAL- included, so patch's re-scan stops on one. Fixed as recorded in decisions.

## 2026-10-28 — The smallest fix for npm and Composer

Candidates move only the planned packages (decisions, same date). Real Docker, built CLI, temporary copies of the examples:
- npm, `--apply`: lodash 4.17.20 → **4.18.0** (the old unscoped `npm update` chose 4.18.1); `changed_packages` is lodash only; requirement stays exact; applied in 17 s.
- Composer, `--apply`: **stopped**. The plan (5.4.0 → 5.4.50, the smallest version OSV lists as fixing both advisories) was refused by Composer because Packagist's advisory database still flags 5.4.50 (PKSA-xmwy-rmx5-m7h4). No file changed; exit 2.
- Maven, validation only: commons-text 1.9 → 1.10.0 and transitive commons-lang3 3.11 → 3.18.0, `validated` (128 s with image pulls).

Local: typecheck pass; CLI tests 83 passed / 1 skipped, sandbox 46 passed.

Round 1 review of #142 (REQUEST CHANGES): the npm transitive override was global, so another installed version of the same name drifted to its newest in-range release (reproduced by the reviewer with semver 6.1.1 → 6.3.1). Fixed with a version-scoped override plus a fail-closed check that no unplanned baseline version disappears; also duplicate plan names, the Composer `--`, `changed_packages` recorded before the compatibility check, and two raw NUL bytes that made git treat `dependency-patch.ts` as binary.
Real Docker after the fix, built CLI, `--apply`: the reviewer's scenario as a project (make-dir 3.0.0 + normalize-package-data 2.5.0, lockfile from before 2019-06-01, so semver 5.7.0 nested and 6.1.1 hoisted, both vulnerable): semver 5.7.0 → 5.7.2 and 6.1.1 → 6.3.1, each to its own smallest fix, plus the planned hosted-git-info 2.7.1 → 2.8.9 and path-parse 1.0.6 → 1.0.7; nothing else moved, no override left in package.json, 0 known findings after, smoke test passed. npm example again: lodash 4.17.20 → 4.18.0, applied. Local: typecheck and build pass; vitest 185 passed / 1 skipped.

Found by the judge (next PR): lodash 4.18.0, the smallest version OSV lists as fixing lodash's five advisories, is deprecated on npm ("Bad release. Please use lodash@4.17.21 instead."). The patch command does not read deprecation; the judge stops it.

## 2026-10-28 — Judge v0 (npm) and its backtest

`ludion judge --before <dir> --after <dir>` (decisions, same date). Live on the npm example's fix (lodash 4.17.20 → 4.18.0): **stop**, because 4.18.0 is deprecated on npm ("Bad release. Please use lodash@4.17.21 instead."), plus a publisher change (extend). Tests: 35 judge unit tests after the review rounds (some now cover several cases) (every stop and extend rule, the newest-publish wait, a malicious passenger behind a clean target, undecidable cases, gate 4, urgency, provenance parsing).

Backtest (docs/bench/2026-10-28-judge-backtest, numbers there):
- Malicious releases of 2025 (OSV MAL-, 1,412 versions in 969 packages with an earlier clean version), stopped by the wait and the re-query, conservative–optimistic: 12h 52–55%, 24h 78–84%, 72h 90–94%, 7 days 93–95%. Estimates, not bounds (see the README). Gate "stop every known malicious release": **not met**.
- Genuine fixes (200 sampled from 2025's npm GHSA fixes, rerun after the review fixes): median delay 72h, p90 144h; 35 stops with today's facts, of which 3–11 would have existed when the wait ended (the rest are later deprecations and advisories). Gate "median delay within 24h": **not met** with the initial waits.
- Notification reduction (100 repositories): not measured yet.

What the numbers say: most malicious releases are recorded within a day (median 11.5h), so the 24h–72h band is where the trade-off sits; a 24h normal wait would meet the delay gate and give up about 10 points of malicious-release stops (78–84% instead of 90–94%). The owner decides the table; the backtest can be rerun with other waits from the cached data.

Also from #142's round-2 review: a vulnerable nested copy of a direct dependency now stops with a clear reason instead of rewriting the direct requirement; an existing project override at any depth stops; docs say why Maven is exempt from the removal check.

Round 1 review of #143 (REQUEST CHANGES): gate 4 accepted another package's tarball and hash under a trusted name; the new version's own advisories and downgrades were ignored; the malicious figure was called a lower bound although its timing can over-count. Fixed: the judge accepts only the registry's own tarball URL and sha512 for exactly that name and version, stops on downgrades, on new advisories and on new links, compares a copy with the one at the same install path, and is undecidable without the PR's changed files or when a lookup fails; the backtest reports conservative and optimistic timings, and the genuine-fix sample was rerun. Live: the deprecated lodash 4.18.0 still stops; the two-semver fix produced by `ludion patch` passes gates 1, 2 and 4 with publisher-change extensions (npm's real lockfile URLs and hashes pass the strict checks). Local: typecheck and build pass; vitest 211 passed / 1 skipped.

Round 2 review of #143 (REQUEST CHANGES): gate 4 still skipped entries whose name@version already existed (a re-pointed lodash 4.17.21) and second copies of a new version. Fixed: gate 4 checks every lockfile entry that changed at its path, every copy, against the registry's tarball and hash; links are compared with their targets; a dev-only fix no longer hurries a production passenger (urgency uses only the fixing packages); a changed-files list without package-lock.json is undecidable. The backtest JSON now records the record count. Local: typecheck pass; judge tests 28.

Round 3 review of #143 (REQUEST CHANGES): the diff still skipped any version already installed somewhere, so a root copy moved down to a vulnerable version a nested copy had, or a path re-aliased to another package, reached "ready except build". Fixed: the diff is per install path and compares each path with what it held before; a different package at the same path stops. The genuine-fix sample was regenerated and now records its candidate count. Local: judge tests 29.

Round 4 review of #143 (REQUEST CHANGES): removing a nested copy let its dependent fall back to a vulnerable version (or an alias) already installed, unseen; and package.json changes (a root postinstall, a git spec) were never read. Fixed: a removed copy is judged as a change to what its dependent now resolves to; package.json may change only registry dependency specs; also non-plain lockfile keys are refused, bundled dependencies stop, a changed hash at the same version is judged, and the comment states the npm 7+ reading and that nothing schedules the re-query. Local: typecheck and build pass; vitest 218 passed / 1 skipped (33 judge tests). Live results unchanged.

Round 5 review of #143 (REQUEST CHANGES): a dependent could still be moved onto an already-installed vulnerable version or alias by a shadowing copy or by moving the dependent itself. Fixed with a resolution diff: for every dependent present on both sides, each declared package is resolved before and after, and any package it did not load before is judged. Also refused: lockfile paths that differ only in case, and dependency groups that are not objects. Local: typecheck and build pass; vitest 220 passed / 1 skipped (35 judge tests). Live results unchanged.

Round 6 review of #143 (REQUEST CHANGES): a dependent that was itself upgraded could take an already-installed vulnerable copy or alias, because dependents were keyed by name@version. Now a copy at an unchanged place is compared with what it loaded there, and a moved or upgraded one with what any copy of that package loaded; a newly added requirement is listed under "not checked". Local: typecheck and build pass; vitest 220 passed / 1 skipped. Live results unchanged.

Round 7 review of #143 (REQUEST CHANGES): a moved dependent was excused when another version of the same package had loaded the same target. Now a dependent at a new place is unchanged only if every earlier copy of that package loaded the same target; otherwise it is judged against the highest earlier target and any differently named one. The reviewer replayed 32 real lockfile changes from this repository: no new false stop. Local: typecheck and build pass; vitest 220 passed / 1 skipped.

Round 8 review of #143 (REQUEST CHANGES): a moved dependent was compared only with the highest earlier target, so a target equal to it hid new advisories. Now it is compared with each earlier target that differs. Local: typecheck and build pass; vitest 220 passed / 1 skipped.

## 2026-10-28 (cycle 2) — The judge on this repository's PRs

Added `.github/workflows/judge.yml`, `.github/workflows/judge-comment.yml`, `.github/judge/record.ts` and `packages/cli/test/judge-workflow.test.ts` (16 tests). Decisions: "The judge on this repository".

Checked in Docker (node:24-slim with jq 1.6; `npm ci` with network, then no network, read-only root, non-root):

- Typecheck passes. Packages tests: 226 passed (210 before, plus the 16 new ones). `apps/site/test/knowledge.test.ts` does not load there because the image has no git; CI runs it.
- Each of 14 single breaks makes at least one of the 16 tests fail, and all pass again once it is undone. The breaks: a write permission in either job; a checkout or npm in the comment job; the run-head check removed; extra keys accepted by the schema; the judge's text not indented; the judge built from the PR head; install scripts allowed; an action pinned by tag; the upload skipped after a failure; and a timeout, a mismatched exit code or unparseable output recorded as anything but undecidable.
- End to end on this repository's lockfile, with npm's lockfile-only update of @types/node 24.19.1 → 24.19.2 as the PR: the record script ran the built judge in 1.094 s, with the verdict "ready except build". judge-comment.yml's schema accepted the record, and its comment rendered.
- A change to `packages/cli/package.json` alone (no lockfile change) was recorded as undecidable.
- actionlint 1.7.12 (Docker, with shellcheck): 0 errors in the two new workflows. `publish.yml` has one existing info-level shellcheck note (SC2016), not changed here.

Not run: judge-comment.yml on GitHub, since `workflow_run` runs only from the default branch.

CI at 141d38e: `test` passed (vitest 281 passed; Playwright and axe 30 passed and 1 skipped).

The first review asked for changes (decisions, "The judge on this repository"). After the fixes, checked the same way in Docker:

- typecheck passes;
- packages tests: 229 passed, with the workflow tests at 19;
- each of 26 single breaks makes at least one test fail: the 14 above, and 12 for the fixes (the refusal removed, its pattern or its 300-file limit changed, the PR's file list used instead of the compare API, the head repository check removed, a SHA with a final newline accepted, the indentation left out of the text limit, a zero-width character kept, a missing record passed quietly, no overwrite on a re-run, the text not cut, and comma file names passed through);
- the end-to-end run again judged @types/node 24.19.1 → 24.19.2 "ready except build", in 0.918 s;
- actionlint: 0 errors in the two workflows.

The second review asked for changes: the event's base SHA goes stale (decisions). After the fix (386f802), checked in Docker:

- typecheck passes;
- packages tests: 230 passed, with the workflow tests at 20;
- each of 34 single breaks makes at least one test fail. These are the 26 above, with two rewritten for the changed lines, and 8 new ones:
  - the before files, the file list or the build taken from the event's base;
  - the base-branch check removed;
  - the record naming the event's base;
  - 39 hex digits plus a newline accepted as a SHA;
  - PRs into other branches commented;
  - tag characters kept.
- actionlint: 0 errors in the two workflows.

On GitHub, through the throwaway draft PR #159 (base `ci/judge-dogfood`; npm's lockfile-only update of @types/node 24.19.1 → 24.19.2), judge.yml ran from that PR's merge commit:

- Run 40665174013, at head 13a361d: the job succeeded, 09:33:36–09:33:54 UTC.
  - The record: `ready_except_build`, base 386f802 (the merge commit's first parent), judge 0.577 s, 12.781 s since the job started.
  - In Docker, judge-comment.yml's schema accepted the downloaded record, and its comment rendered.
- Then `ci/judge-dogfood` moved to 570add8, and an empty commit went to #159. Run 40665447810, at head baf6d37: the job succeeded, 09:35:41–09:36:00 UTC.
  - The PR's stored base SHA was still 386f802. The record's base was 570add8, the merge commit's first parent, so the stale-base case is judged.
  - The record: `ready_except_build`, judge 0.701 s, 12.366 s since the job started.
  - The schema accepted it.
- #159 was then closed without merging, and its branch deleted.
- judge-comment.yml has still not run on GitHub.

## 2026-10-28 — Packagist advisories in Composer plans

Composer scans and plans now read Packagist's advisory API next to OSV and take the later fix. New tests: Packagist's later fix wins over OSV's, OSV's later fix is kept, a Packagist-only advisory is found, a fix landing in the next range moves on, unaffected and empty answers stay clean, no same-major fix and unreadable ranges block, and an outage, a missing field, an unrequested name, a record for another package and an invalid id all fail the scan; npm inventories do not query Packagist. Local run in Docker (node:24-slim, no network, read-only root, non-root): typecheck passed; packages tests 176 passed. The site build needs git and was not run in the container; CI runs the full suite.

## 2026-10-28 — Backtest rerun with the registered definitions

Ran after the definitions were committed (ccc463e, #144): `tools/backtest/src/malicious-v2.ts` (new) and `tools/backtest/src/fixes.ts` (now also records the advisory's publish time and the added delay). Same OSV export as the first run; registry and live advisory data read 2026-10-28; both in Docker. Results and raw data: docs/bench/2026-10-28-backtest-rerun/.

Malicious denominator: 1,148 versions in 767 packages, all selectable only as transitive dependencies (none is an OSV fixed version); 4,198 versions of new fake packages counted apart; 600 unknown. Stopped (conservative timing): 928 (80.8%) at 12h/24h, 1,044 (90.9%) at 72h, 1,070 (93.2%) at 168h. Almost every stop is the OSV re-query; 1,140 of the 1,148 are removed from the registry, so provenance, scripts and publisher cannot be read for them. Added delay for genuine fixes (median): exploited 16.4h (n = 6), high 0h (n = 21), normal 41.5h (n = 138), low not in the sample.

Gate: **not met**. The delay gates are met; "every malicious version stopped" is not, at any wait. The wait table is unchanged.

## 2026-10-28 — The time cap, and backtest v3

The owner kept the wait table and asked for the dependencies that move with a fix to be capped at the fix's publish time T (decisions: "Moving dependencies are capped at the fix's publish time").

- **#147** fixed the rules and backtest v3's definitions before any v3 code ran (bd0bc02, 14:10 JST).
- **#148** implements them:
  - Rule 1: a version published at or after T that was not already locked stops the change.
  - Rule 2: a new dependency younger than the base wait at T stops it.
  - Rule 3: the comment always shows the count of versions published at or after T.
  - Coverage: `ludion judge` (npm, and pnpm as a version set that is never ready), and `ludion patch` candidates (npm, and Composer with Packagist's author-set release times).
  - Checked in Docker: typecheck passed and 184 package tests passed.

**Backtest v3** (`tools/backtest/src/malicious-v3.ts`, `fixes-v3.ts`; results and raw data in docs/bench/2026-10-28-backtest-v3/):

- Every one of the 5,398 npm GHSA fixes published after a malicious version had its tree resolved as of its own T.
- 7 of the 1,148 malicious versions are ever selected by such a fix:
  - one is missed at every wait: @ensdomains/buffer 0.1.1, published 2023 and named by a 2025 record;
  - six are caught by the re-query.
- Unknown is 156 at 12h/24h, 93 at 72h and 76 at 168h. In each, a fix in the version's window resolves through a branch the registry no longer serves.
- Stopped: 991 at 12h/24h, 1,054 at 72h, 1,071 at 168h (rerun: 928, 1,044, 1,070).
- Gate 2 signals are unverified for the 1,140 removed versions. deps.dev has none of them, only 1,016 of their predecessors.
- Genuine fixes: 49 of 200 are stopped (rerun: 35).
  - 29 are stopped by rule 1, 14 of them by nothing else. These are monorepo siblings published after the fixed package, for example next and `@next/env` 5–11 seconds later.
  - The median added delay is unchanged: exploited 16.4h (n = 5), high 0h (n = 19), normal 41.5h (n = 127).
- A script bug that made removed versions unselectable was found in the first execution and corrected before the write-up. The definitions are unchanged.

Gate: **not met** (1 missed and the unknowns, at every wait). The delay gates are met. The wait table is unchanged.

## 2026-10-28 — Rule 1's same-release exception

#151 changed `time-cap.ts` (`sameRelease()` and the `same_release` list), `npm-facts.ts` (the shared-publisher fact, the provenance source commit, the statement's subject check), `judge.ts` (passes those facts to the cap; the "not checked" line), `dependency-patch.ts` (`ludion patch` reads them for the planned versions and those after T; its targets are the plan's own versions), their tests (`judge.test.ts`, `dependencies.test.ts`), and docs/decisions.md and this file. (Corrected 2026-10-28, cycle 2: this paragraph used to name only `time-cap.ts`.)

`sameRelease()`: a version published at or after T may move with the fix when it is the same release as a target. With provenance, that means the same repository, workflow and commit. Without provenance, it means the same publisher account and version number, published at most 15 minutes after its target. Used by `ludion judge` (npm, pnpm) and `ludion patch` npm candidates; Composer is unchanged. Checked against the registry: `next@15.2.3` and `@next/env@15.2.3`, published 10 s apart, carry the same repository, workflow and commit, so the provenance branch allows the pair.

The independent review of #151 asked for changes in round 1. Its one blocking finding: trusted publishing's shared "GitHub Actions" user matched across unrelated packages. Round 2 approved at 08aa452, and its non-blocking findings were handled too. Both rounds are recorded in docs/decisions.md as the amendment made before backtest v4. The last recorded review was the delta review at b885de6 (`reviewed-sha: b885de6…`); the PR was merged at f78c931, a later docs-only commit, with no review recorded for that head until the post-merge review below. On the registry, the subject check passes on `next@15.2.3`, `@next/env@15.2.3` and `get-jwks@11.0.2`, and get-jwks's trusted publisher counts as no account. Local run in Docker (node:24-slim, no network, read-only root, non-root): typecheck passes; packages tests: 206 passed. The site build needs git and was not run in the container; CI runs the full suite.

## 2026-10-28 — Backtest v4: rule 1 with the same-release exception

The definitions were committed before either script ran: e995557 at 15:04 JST (#150), the stricter amendments 08aa452 and 17b55b7 (#151), and f78c931 at 15:36:07 JST (#151, the exact wording of the publisher-name rule, docs only; pushed by 15:36:11, when its CI started). (f78c931 added 2026-10-28, cycle 2.) Scripts: `tools/backtest/src/fixes-v4.ts` and `malicious-v4.ts` (5ef3a5f). They ran in Docker from 15:37 to 15:48 JST. Data: v3's OSV export, registry and deps.dev, read 2026-10-28. Each result is computed with and without the exception on the same data; without it, the run reproduces v3's numbers exactly. Results and raw data: docs/bench/2026-10-28-backtest-v4/.

Gate: **not met**. The delay gates are met: exploited 16.4h (n = 6), high 0h (n = 21), normal 41.5h (n = 138). "Every malicious version stopped" is not met at any wait:

| Wait | Stopped | Missed | Unknown |
| --- | --- | --- | --- |
| 12h and 24h | 990 of 1,148 | 1 | 157 |
| 72h | 1,052 | 1 | 95 |
| 168h | 1,071 | 1 | 76 |

- **Genuine fixes.** The exception removes all 29 of rule 1's stops on the 200 genuine fixes, 14 of which rule 1 stopped alone. It allowed 69 versions in 30 updates: 29 through provenance with the same repository, workflow and commit, and 1 through the publisher branch (@apollo/composition). 14 updates go from stop to ready (except build). Stops drop from 49 to 35, and the 15 remaining former rule-1 stops are next releases stopped by today's deprecation.
- **Malicious, what the exception let in.** Nothing: no malicious version was allowed as a sibling, and none is selected only because the exception unblocked a tree. The 7 versions published before the T of a fix that selects them are v3's 7. The miss is the same, @ensdomains/buffer 0.1.1 (a 2023 version, record in 2025); the other six are caught by the re-query.
- **Malicious, what the exception changed.** loliloli 1.0.108 (12h to 72h) and @alexcolls/nuxt-ux 0.6.2 (72h) go from stopped to unknown, not missed. n8n fix trees that rule 1 stopped now resolve with branches the registry no longer serves, and the registered rule counts those as unknown.
- **Unverified.** Gate 2's provenance, scripts and publisher remain unverified for 1,140 of the 1,148 removed versions.
- **Second execution.** A second, diagnostic execution (baafc36) only added the fixes behind each unknown, and gives identical counts.

## 2026-10-28 (cycle 2) — Dependabot for npm

Added `.github/dependabot.yml`: npm version updates for the root directory, weekly, at most 5 open PRs. Decisions: "Dependabot feeds the judge". In Docker (python:3.14-slim), check-jsonschema 0.33.0's vendored Dependabot schema accepts the file; with `interval: fortnightly` it rejects it. Dependabot reads the file only from the default branch, so its first PRs come after the merge; nothing has run yet.

## 2026-10-28 (cycle 2) — #151's post-merge review, and its fixes

#151 was merged at f78c931, a docs-only commit after the last recorded review (b885de6). A fresh-context subagent reviewed the full diff 2c1c1e7..f78c931 after the merge: **APPROVE**, with three non-blocking findings. The verdict is on the PR (https://github.com/Ludion-ai/ludion/pull/151#issuecomment-6463525016, `reviewed-sha: f78c931ecd4a3bd46eb58483a0f8d52008d862c9`). This PR fixes them (decisions: "After #151's post-merge review"):

- The judge's rule-1 targets are now the change's own fixing versions (`ownFixes`): per advisory, package and vulnerable version, the smallest version it changed to. They used to be every changed copy of a fixed package's name. The exposure date counts the same way. Urgency counts every fix that matches a change on name, vulnerable version and new version, so moving a production dependent off the vulnerable version keeps its urgency (round 2).
- The residual risk for `ludion patch` is stated correctly: it has no wait and no re-query.
- The publisher-name comments and tests now say what the code does.

The PR's own review asked for changes in round 1 (https://github.com/Ludion-ai/ludion/pull/153#issuecomment-6463758266). Its blocking finding: the first version keyed targets by the fixing version only. A dependent that moves from the vulnerable root copy to a newer nested copy gives that copy the vulnerable `from` through the resolution diff, so it stayed a target. Fixed with `ownFixes`; the case is tested through `allChanges` and `gatherFacts` (stubbed fetch). Also from round 1:
- the exposure date uses the same match;
- a delta review is enough only for PRs without protected paths;
- a wrong fact in the #151 file list is removed.

Local run in Docker (node:24-slim; `npm ci` with network, then no network, read-only root, non-root): typecheck passes; packages tests: 210 passed (rounds 1 and 2). The new target and `allChanges` tests fail with the earlier rules (checked on a copy). The site build needs git and was not run in the container; CI runs the full suite. The backtests were not rerun: their updates hold one copy of the fixed package, so the change should not move them, but that is not checked.

## 2026-10-28 (cycle 2) — The miss, the unknowns and the stop-rate interval (investigation only)

docs/bench/2026-10-28-cycle2-investigation. No definition or result changed.

- **@ensdomains/buffer 0.1.1, the one miss.**
  - MAL-2025-190866 was published 2025-11-24T16:31:47Z and modified 2025-11-26T00:08:10Z. Of its three sources, only GitHub's malware advisory names 0.1.1; all three name 0.1.2, the Shai-Hulud 2.0 version.
  - 0.1.1 was published 2023-02-28T09:46:00Z by a listed maintainer. jsDelivr and Software Heritage hold identical copies of its 21 files (same sha256), and Software Heritage's archived tarball has the sha1 the registry recorded for it (whether its loader checked that sha1 when downloading is not checked). Every code file equals 0.1.0's, and there are no install scripts. The worm's `setup_bun.js`, `bun_environment.js` and `preinstall` appear only in 0.1.2.
  - It was selected through @ensdomains/ens-contracts 0.0.22 (GHSA-rrxv-q8m4-wch3, T = 2023-07-10), which declares `^0.1.1`, as ens-contracts has since 0.0.20. So from 0.0.20 or 0.0.21 it was already in the lockfile.
  - The record came about 2.4 years after the judgement time, so the re-query could not stop it, and no bug was found. No stop signal readable then fires (the publisher change only extends the wait).
- **The unknowns.**
  - All 157 at 24h trace back to 86 unreadable keys: 59 removed versions, 23 dist-tag or invalid specs, 3 unverified same-release checks and 1 package not served. rc@1.3.9 alone is behind 155.
  - Clearable through tree data, at most: deps.dev 0; ecosyste.ms 2 / 0 / 1 (24h / 72h / 168h); jsDelivr 0; Software Heritage none of the top 7 blockers. A perfect archive would clear at most 113 / 54 / 37.
  - Separately, ecosyste.ms shows a new install script for 44 / 8 / 2 unknown versions, which would be stops if that source were accepted. That would be a new definition and a new run.
- **v4 as an interval** (unknown = missed … unknown = stopped): 86.24%–99.91% at 12h and 24h, 91.64%–99.91% at 72h, 93.29%–99.91% at 168h. The fractions are in the v4 README.

## 2026-10-28 (cycle 2) — Noise measurement: count met, misses not met

docs/bench/2026-10-28-noise. The definitions were fixed before the run: d29b1e7, then amended up to b394292 after six review rounds on #155, merged as 3418d55. The search was committed first (2ee1afc), with one recorded deviation: pages of 50 after HTTP 502s. The first execution ran from 17:56:01 to 18:13:03 JST, and its output was committed as 3105fac.

- **Sample.** 100 public repositories with Dependabot npm PRs on 2026-10-27, from 256 considered.
- **Count gate: met.** npm audit 1,867 against the judge's production count 560 (1,680 ≤ 1,867).
  - Shown, not gated: against npm's direct findings the judge's count is 0.515 of it, and against `--omit=dev` 0.604.
  - The per-repository median ratio is 0.2169.
- **Miss gate: not met.** Five fresh-context subagents checked all 538 left-out packages against advisories and code.
  - Verdicts: 65 yes, 371 no, 102 undecidable. That is 167 misses in 32 repositories.
  - All 538 were left out as dev-only per the lockfile. Some yes verdicts are packages a production build or runtime takes from devDependencies: dompurify in a deployed bundle, shipped Electron runtimes, esbuild under `tsx` in a production image, markdown-it bundled through graphiql. Many other misses count only because of the rule's wording ((b)'s declared-dependency reach, (d)'s `start`) or because they are undecidable. The reviewers' evidence for 88 of the 102 undecidable verdicts shows no shipped code loading the package.
  - The reviewers read parts of the rule differently ((b) dependency reach, (d) dev-server starts, (c) bundler helpers, CSS-only imports). The README reports those differences next to the tally. Some yes verdicts depend on none of them, so the gate fails under any of those readings.
- **One judge failure.** The judge's lockfile reader refused one repository's lockfile (an unexpected `packages/` path under `node_modules`). That repository was excluded and reported by cause.

The design's noise gate is **not met**. The judge's production/dev split (the lockfile's `dev` flag) cannot by itself decide "loaded in production". No definition is changed.

## 2026-10-28 (cycle 3, L4) — Dogfood record, and the action prepared (not released)

docs/bench/dogfood.
- **Judged.** 3 dependency PRs (#161 stop, #162 stop, #163 ready_except_build) in 5 judge attempts. judge_seconds ranged from 0.629 to 5.637 and job_seconds from 12.742 to 21.72.
- **Step 1 checked.** On #161, re-runs 2 and 3 logged `Updated the judgement comment`: one comment, 6467253162.
- **Not judged.** #164 and #165 had no judge run; the cause is not known.
- **The stops.** #161 stops on gate 4 only, because the PR also touches a workspace's package.json (apps/worker). #162 has the same gate 4 stop (apps/site) and two gate 2 stops: unist-util-visit-parents@6.1.0 and unist-util-visit@5.2.0 were published at or after T.
- **The action.** Checked locally in Docker with gh stubbed (17 of 17), and live in mode judge on throwaway PR #169, which is closed. Mode comment has not run on GitHub.
- **npm pack.** README.md, dist/cli.js and package.json. Nothing was published.

## 2026-10-28 (cycle 3, L1) — Gate 1's split rebuilt; the noise rerun: count not met, misses not met

- Definitions pushed before any implementation (77f905a). `production.ts`, `ludion judge --source`, and the lockfile reader's skip of npm's extraneous folders (c381a85; 25 new tests). The rerun's first execution at c381a85: 100 of 100 repositories, none failed.
- Count: the judge 938 against npm audit 1,867. 2,814 > 1,867, so **not met** (the first run had 560, met). npm audit's numbers did not change. The rebuilt split on the first run's own OSV results also gives 938.
- Misses: 160 left out, every one a first-run "no". Five fresh-context reviewers gave 11 yes, 149 no (137 reused) and 0 undecidable: **11 misses in 4 repositories**, so **not met** (the first run had 167 misses in 32 repositories). Every first-run "yes" and "undecidable" is now counted.
- JakeWharton/jakewharton.com's lockfile now reads.
- One reviewer ran `npm ci` on the host by mistake. No install script ran (docs/bench/2026-10-28-noise-v2/README.md).
