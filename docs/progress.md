# Progress

What was built, what the check showed, what was decided and why. Newest first. Numbers come from `docs/bench/`.

## Done when (CLAUDE.md)

| | Check | State |
| - | - | - |
| 1 | Single player: a lesson taught in project A shows up via `ludion sync` in project B, and Claude Code in B gets right the task it got wrong before | **shown**: 1/5 before, 5/5 after sync, 3/3 through the plugin hook (`docs/bench/2026-10-11-done1/`) |
| 2 | Plumbing: `ludion teach --public` → merge → within five minutes `ludion sync` elsewhere writes it with the teacher's name, and `ludion_ask` returns it | `ludion-ai` 0.1.1 is on npm (npm refused the name `ludion`); waits for the owner's own `teach --public` |
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
3. [running] `tools/seed`: package + version range → changelog, releases, source diff → drafted candidates → kind (with the "does code that doesn't use it behave differently" check) → differential tests → Docker → FreshBench `models` → harm check → one PR per subject labeled "drafted by an agent". Run it on the 30 existing seeds and compare (candidates, kept, review findings, in `docs/bench/`). Then a nightly workflow that watches covered subjects' new releases and opens PRs (protected).
4. [running: candidates collected and triaged on branch seed-pipeline] Two or more new subjects (target 6). Score 20 candidates on "AI writes it often" × release frequency × share of silent changes in the last 180 days; table in decisions. Each: FreshBench questions and keys from primary sources, seeds frozen, then B measurement and harm check. One seed PR per subject (protected).
5. [done, #55] Personal ledger: `ludion teach` accepts drafts without evidence, saved as `unverified`, shown in `lessons.md` as "unverified, yours only". `--public` still needs evidence.
6. [harness ready on branch exp3-unrelated] Experiment 3: 0, 50 and 500 correct but unrelated lessons, B accuracy. A drop of 10 points or more at 500 → build skill delivery (`.agents/skills/ludion-{subject}/SKILL.md`); otherwise don't, and say why.
7. [running daily since 2026-10-12] C tasks: one batch a day (method in `docs/bench/2026-10-11-done3/README.md`). If C's gain is 10+ points below B's (+27), build the check hook (PostToolUse on Edit/Write matching imports and symbols against installed-version lessons) and measure it on part of C; otherwise don't, and say why.
8. [README and demo #58; letters not yet] Announcement tools: README rewritten (measured numbers only), a 90-second demo (asciinema or GIF), five maintainer letters drafted in `docs/outreach/` (two to company-backed libraries, with a per-subject table of changes current models get wrong silently, asking whether they would pay for measurement). The owner sends them.
9. [done, #57] Check that `llms.txt` and the per-lesson static pages are in a shape web search picks up.
10. [ ] License: the owner decides; only a draft consent sentence for the `teach --public` PR template goes in `docs/decisions.md`.

### Where the running work lives (for resuming)

- Worktrees: `C:/dev/ludion-wt-seed` (branch `seed-pipeline`: `tools/seed`, `.github/workflows/seed-watch.yml`, results in `docs/bench/2026-10-12-seed/` and `docs/bench/2026-10-12-subjects/`), `C:/dev/ludion-wt-exp3` (branch `exp3-unrelated`: `tools/bench/src/unrelated.ts`, CLI built from main at `e7d82d7`).
- Large caches outside the repo: `C:/dev/ludion-seedwork/` (unpacked packages, agent folders, logs `draft-silent.log`, `subjects20.log`, `c-batch-<date>.log`, the bench projects in `bench-projects/`, the day's C batch script `c-batch.sh <ids>`).
- The pipeline's steps resume from their files: rerun the same `node tools/seed/src/cli.ts <step> <dir>` command.
- C tasks: `bash C:/dev/ludion-seedwork/c-batch.sh <ids>` runs one day's tasks under both conditions (frozen seeds served from `C:/dev/ludion-freeze`); results land in `docs/bench/2026-10-11-done3/` of `C:/dev/ludion` and are committed in a docs PR.

## Log

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
