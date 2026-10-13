# Progress

What was built, what the check showed, what was decided and why. Newest first. Numbers come from `docs/bench/`.

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
8. [README, 89-second demo, Show HN and X drafts, two letters: in PR "announce-materials" (2026-10-13)] Announcement tools: README (measured numbers only), an 89-second demo (`docs/demo/sync-vitest.cast`), one maintainer letter per subject, two so far (Cloudflare for wrangler and the Agents SDK together, and Vitest; each with a per-subject table of changes current models get wrong silently, asking whether they would pay for measurement), a Show HN post and one X post. The owner sends and posts them. More letters wait for the owner's discussion and for the subject to be measured.
9. [done, #57] Check that `llms.txt` and the per-lesson static pages are in a shape web search picks up.
10. [#60 open, docs only] License: the owner decides; only a draft consent sentence for the `teach --public` PR template goes in `docs/decisions.md`.

### Spending rules (2026-10-12, in force; details in `docs/decisions.md`, "Spending")

Heavy work one job at a time; Opus only for the review of protected PRs (one round); pipeline work on Sonnet; no per-lesson model FreshBench; no daily C batches; big files read through summaries; this file updated after each work item.

### What waits for the owner, in order (2026-10-13, latest)

1. ~~npmjs.com, `ludion-ai`: approve 0.1.4, reject 0.1.3.~~ **Done** (checked 2026-10-13): `latest` is 0.1.4, and 0.1.3 is deprecated ("Use 0.1.4 or later"). `npx ludion-ai@0.1.4 sync` in an empty folder against production exited 0 (`docs/bench/2026-10-13-done2/sync-production-0.1.4.txt`).
2. ~~Done 2, one line~~ **Done, passed** (2026-10-13): the owner ran `teach --public` from their own terminal (an agent's attempt stops at the confirmation, as designed), #97 merged; the three times and the three checks by hand are in `docs/bench/2026-10-13-done2/result.json`.
3. **Protected PRs, merge order** (opened once a day, together; the first batch is opened with this update's PR): see the PR list below.
4. **Not started, waiting for the owner's yes:** counting distinct clients of `/index/*.json` in the Worker (Analytics Engine; a daily-salted hash of the User-Agent, path and `CF-Connecting-IP`, no raw IP). It changes `wrangler.jsonc` (protected) and adds server-side counting next to the README's "no telemetry" (that line is about the CLI), so it is held until the owner confirms they want it.

### Open PRs and what waits for whom (2026-10-13, after the owner's merges)

- **Merged by the owner on 2026-10-12 (UTC):** #62, #75, #76, #80, #84 (25 lessons), #73 (nightly seed watch), #54 (issue form). Production serves them since deploy run 38311678194 on `6dedffa`: `/index/subjects.json` lists agents 15, vitest 17, wrangler 23 active lessons. The deploys for the commits in between failed on purpose at "Make sure this is main's newest commit".
- **#73 drafts nothing yet**: it needs the `ANTHROPIC_API_KEY` repository secret (a secret value, the owner's). Without it, the nightly run lists new releases in its artifact and stops.
- **Waiting for Codex's fixes, then the owner's merge, in this order:** #67 (changes requested; also conflicts with main in `docs/decisions.md`), #68 (approve; rebase onto main after #67: `git rebase --onto origin/main 1ed1411 codex/runtime-task-acceptance`), #69 (changes requested; rebase after #68). Details in the review comments.
- **After #67 to #69 are on main (this side):** rebase open work, bump the CLI to 0.1.5 with the plugin pin (0.1.3 was skipped and 0.1.4 carries the User-Agent), run `publish.yml` (the owner approves the staged version on npmjs.com), and dispatch `reverify` (lessons on main haven't run under #67's Docker flags).
- **Not waiting on a merge tap:** #60 (consent sentence draft, docs only) waits for the owner's license decision.

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

### 2026-10-13 (later): 0.1.4 is on npm; Done 2 passed

- **npm**: the owner approved 0.1.4 (`latest`) and 0.1.3 is deprecated ("Use 0.1.4 or later"). `npx ludion-ai@0.1.4 sync` in an empty folder against production exited 0 and wrote `.ludion/lessons.md` and `CLAUDE.md` (`docs/bench/2026-10-13-done2/sync-production-0.1.4.txt`). The `User-Agent` the CLI now sends was checked on the built CLI against a local server (#92); nothing in the Worker reads it yet.
- **Done 2: passed.** Taught by `Ludion-ai` with `ludion-ai@0.1.4 teach --public` (#97, opened 08:34 UTC), `verify` and `test` green, a fresh Opus review said APPROVE (comment on #97; it ran no lesson code), merged 08:40:22 UTC. From the merge, in seconds: `/index/vitest.json` lists the lesson at 67, `ludion sync` in a copy of the fixture project writes it with `Taught by @Ludion-ai` at 74 (second attempt), `ludion_ask` returns it at 75; the limit is 300. `author_id` is the PR account's id. The three checks by hand (sync in another folder, the teacher's name in `lessons.md`, `ludion_ask`) gave the same. One lesson, one run: the five minutes is shown for this path on this day, not a distribution.
- **A guard that worked**: run by an agent, `teach --public` stopped at "Teaching in public needs you at a terminal to confirm"; the owner ran the same line themselves. No way around it was tried.
- **A gotcha**: `npx ludion-ai@0.1.4 ...` started inside a checkout without `npm install` fails with "'ludion' is not recognized" (npx picks the workspace's own package); run it from another folder. Now in the Done 2 README.

### 2026-10-13: One cumulative protected PR for owner merge

- #69 now targets main and contains the reviewed #67/#68 source plus #98's agent-boundary correction, merged only into the feature branch after its checks passed. Earlier stacked PRs are superseded by this cumulative diff; main still requires the owner's merge.
- Current main's already-merged lesson is retained. Blob comparison proves every protected file changed by this cumulative PR still matches the completed Opus source snapshot (`docs/bench/2026-10-13-integration/consolidation.json`). The later agent-boundary/E2E changes are unprotected and validated by tests/CI. Exact final-head checks are in #69; no production or npm action was performed.

### 2026-10-13: Benchmark file-tool scope tightened

- Found project-wide bare file-tool allow rules and the `default` tool surface. Replaced these with explicit tools and restricted directory checks; an editing run has no command/subagent tool, while the read-only prepared-project allowances remain.
- Configuration checks, installed CLI boundary documentation and local suite passed (`docs/bench/2026-10-13-agent-boundary/`). No model measurement or actual credential/file-access probe was invoked; old results are unchanged. The correction is now included in cumulative #69; exact-head checks are in that PR and owner merge is still required.

### 2026-10-13: Security/runtime/artifact stack integrated and reviewed

- Integrated main `f48ade4` into #67, then propagated it through #68 and #69; preserved CLI 0.1.4/User-Agent, pipeline changes, hardened shard reading and both histories. Restricted Actions API-key forwarding to explicit no-tool/folder-confined pipeline runs.
- Required fresh Opus review completed with no actionable blocker for each protected PR. Exact reviewed heads, scope and limitations are in `docs/bench/2026-10-13-integration/opus-review.*` and the PR comments; this supersedes the earlier blocked-review status below. Subsequent changes only fix an observed async E2E response-body race and record validation.
- Integrated artifact-stack local typecheck/build/tests passed; records are in the same directory. Final exact-head CI is checked in the PRs. Owner merge remains required; no model benchmark, npm approval/publication or production action was performed by this work.

### 2026-10-13: 0.1.4 staged; a lesson retracted; Done 2 prepared

- **npm**: 0.1.3 staged from #89, then the owner asked for a `User-Agent: ludion-ai/<version>` header in the same release; #89 had merged, so it went in #92 as 0.1.4, which is staged (run 38315009051, "has been staged with tag latest"). The built `dist/cli.js` was checked against a local server: it sent `UA=ludion-ai/0.1.4` on both index requests. Neither is approved yet; the owner approves 0.1.4 and rejects 0.1.3. After approval, `npx ludion-ai@0.1.4 sync` is run in a fresh folder against production and its output added here: not run yet.
- **Retraction**: a fresh Opus review of wrangler 4.113.0#10 (rewritten after #84's review and merged unreviewed) said DROP: a label removal that reads as a behavior change. The file is deleted in a protected PR (opened with the batch); the rule from it (a rewrite after the one review round is reviewed again) is in `docs/decisions.md`. One of 25 pipeline lessons retracted (`docs/bench/2026-10-12-seed/README.md`).
- **Done 2**: found on a draft PR that the required `test` check failed every lesson without search questions, which no teacher's PR can have: fixed in #91. Also found: vitest 4.0.0 needs vite 7.1.11 or older to run (`Unknown method: getBuiltins`), so the draft's tests pin it. CI's Docker run then passed both tests (`docs/bench/2026-10-13-done2/ci.json`). `measure.ts` was rehearsed on #80 and had two bugs, fixed.
- **Announcement materials** (#93, held until 0.1.4 is approved): README, 89-second demo (act 2 is a recorded `teach` and a `sync` elsewhere), Show HN and X drafts, one letter per subject (two so far). A fresh Sonnet check matched every number to `docs/bench/` and found wording problems (tools were read-only, not "default"; lessons frozen, not today's; seeds drafted from the same keys that grade), now fixed.

### 2026-10-13: `/bench`, FreshBench results for sharing

- **Built** (one PR, protected because it changes `.github/workflows/`): `/bench/` (the Done 3 table, a row per model and condition, each cell correct out of questions with its 95% Wilson interval; Haiku 5.5 and Sonnet 5.5 shown as not measured; the without-tools table and per-lesson verdicts from `/models/`), `/bench/<model>/` (questions it didn't get right, each with the change's lesson), 90 run pages with the session logs, `/bench/method/` (`docs/bench/README.md` plus a cost table), `/bench.json`, and a 1200×630 share card per model, screenshotted at build time. `/models` redirects to `/bench/`. Decisions: `docs/decisions.md`, "The bench page".
- **Checked**: every cell recounted from the grades files in a test, and the totals match the Done 3 README (24/45 without sync, 36/45 with); costs match the per-item `costUsd` sums ($5.27 and $5.79). `npm test` and `npm run test:e2e` pass locally, axe included in light and dark, with the new pages; the redirect answers 301; each card is a 1200×630 PNG. Pages looked at in a browser at 1280 and 390 wide, light and dark: on the phone the tables scroll sideways with the model column fixed, and the page itself doesn't (a hidden label inside the table had widened it; fixed).

### 2026-10-12: Source capture and runtime replay prepared

- C runner now captures supported before/after sources and private delivery context outside the score directory, with provenance/integrity references in each new row. No-model CLI replays saved artifacts after verifying source/task/base hashes. Unsupported inputs no longer silently disappear from the snapshot.
- Fixed numeric spending bounds, remaining per-run allowance and condition-safe resume; model measurement is opt-in, unknown reported costs and capture failure stop later runs. Historical results and the spending pause are preserved.
- Worktree `C:/dev/ludion-wt-codex-artifacts`, branch `codex/bench-artifact-replay`, stacked on #68. Check details: `docs/bench/2026-10-12-artifacts/`: local tests and CI artifact linkage/replay passed. PR #69 is stacked on #68. Required review/owner merge remain pending; no model benchmark, npm release or deployment was run.

### 2026-10-12: C-task runtime acceptance pilot checked

- Added optional Docker-only execution acceptance for test selection and top-level mocking tasks. Require actual test participation and relevant assertion failures under implementation mutations; matching regexes or exit zero alone are insufficient.
- New CLI checks fixtures or a complete saved project without invoking a model. Unsupported/infrastructure outcomes stay unscored, and historical C results are preserved. The real Linux Docker fixture outcomes match expectations; raw data/provenance and the static/runtime comparison are in the bench record. Local Docker is unavailable.
- Worktree `C:/dev/ludion-wt-codex-runtime-eval`, branch `codex/runtime-task-acceptance`, stacked on PR #67's hardened runner. Acceptance details/check records: `docs/bench/2026-10-12-runtime/`. Required Opus review remains blocked, so this protected work stays draft for owner review.

### 2026-10-12: Security inspection continued in PR #67

- Added streamed byte limits ahead of public MCP parsing and shard JSON buffering; schema/grounding validation and claim regeneration at the remote reader; canonical ledger PR URLs; atomic, private ledger saves and damaged-entry handling.
- Private ledger sync now protects generated files from default Git staging and refuses tracked files, including Windows case variants. Hardened Docker install/execution privileges and added own harmless Linux CI probes for actual sandbox behavior.
- Updated dependencies to patched MCP peers and sharp through current Wrangler/test tooling. Clean install and audit, tests, E2E, minimum-Node tarball and current-public-data compatibility are recorded in `docs/bench/2026-10-12-security/`.
- Supplemental Codex review exposed two boundary defects that were repaired and regression-tested. Mandatory Opus review remains BLOCKED; owner merge, npm release and production reflection are still pending. No paid benchmark or arbitrary lesson execution was started.

### 2026-10-12: Codex inspection fixes prepared for owner review

- Sync now reads retirement ids even when a subject has no active lessons, suppresses retired ledger copies, and applies public/private corrections before matching installed versions. Offline/legacy public copies carry an unknown-status label; mixed manifest/shard builds abort.
- The CLI minimum and bundle target now match undici: Node 22.19.0. PR and publish CI smoke-test the extracted npm tarball on that exact minimum.
- CLI/MCP/site/index/llms.txt label evidence observations without claiming machine validation of the generated claim's semantics; public lesson reviewers must check kind, range, replacement and signal against primary sources or test assertions.
- Check records: `docs/bench/2026-10-12-codex-fixes/`. Codex static review found no code blocker. **Required Opus review is BLOCKED**: the single invocation returned `usage_limit_reached` before generating model tokens. Leave the protected PR in draft and unmerged until the required review and owner's merge. npm and production are unchanged by these local checks; release still needs a new CLI version and owner's npm approval.

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
