# Progress

What was built, what the check showed, what was decided and why. Newest first. Numbers come from `docs/bench/`.

## Done when (CLAUDE.md)

| | Check | State |
| - | - | - |
| 1 | Single player: a lesson taught in project A shows up via `ludion sync` in project B, and Claude Code in B gets right the task it got wrong before | **shown**: 1/5 before, 5/5 after sync, 3/3 through the plugin hook (`docs/bench/2026-10-11-done1/`) |
| 2 | Plumbing: `ludion teach --public` → merge → within five minutes `ludion sync` elsewhere writes it with the teacher's name, and `ludion_ask` returns it | `ludion-ai` 0.1.1 is on npm (npm refused the name `ludion`); waits for the owner's own `teach --public` |
| 3 | Value: FreshBench on the wedge, Claude Code with default tools in a project with the new version installed, with vs without `ludion sync`: +20 points | B questions on the frozen seeds: **36/45 vs 24/45 (+27)** (`docs/bench/2026-10-11-done3/`). C tasks: running, one trial per task over several days |

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
