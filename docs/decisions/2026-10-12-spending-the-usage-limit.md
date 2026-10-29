### 2026-10-12: Spending (the usage limit)

The batch work hit the plan's usage limit once. From now on:

- **Heavy work one job at a time.** No heavy jobs side by side in the background (drafting, benchmark runs). Light checks may run while one heavy job does.
- **Review.** A fresh-context review is for protected PRs only (`lessons/`, CLAUDE.md, `.github/`, `tools/verify/`, the schema, `ludion.config.json`, `wrangler.jsonc`), one round, by Opus. A second round only if the first found something that had to stop the merge, and then only the changed parts. Other PRs are judged by tests and CI. (Replaces the review of every PR used on 2026-10-12.)
- **Models for the pipeline.** Triage, drafting, machine-check fixes, writing questions, and the benchmark judge use Sonnet (`WORK_MODEL` in `tools/seed/src/llm.ts`). The per-lesson review and the one round of revising content findings use Opus (changed later on 2026-10-12, see "Revising seed drafts"; before, both were Sonnet). Opus is also for protected-PR reviews and for being the model under test. What was already run on Opus stays as measured: the agents run and the first 20 wrangler drafts are Opus drafts reviewed by Opus; vitest drafts are Opus; the rest of wrangler is Sonnet. A comparison of yields across them has that confound, and says so.
- **No per-lesson model FreshBench for now.** All three measured models miss nearly every change (3 to 5 of 45 per trial, `docs/bench/2026-10-11-models/`), so pruning by `models` removes almost nothing. New lessons get no `models` entry (the site shows "not measured"); the verdicts already in `docs/bench/models.json` stay. A weekly batched measurement is to be decided later.
- **No daily C batches.** 16 of 36 tasks are done (`docs/bench/2026-10-11-done3/`). The check-hook rule (item 7 of the work list) needs all 36, so it is undecided, not decided by the 16.
- **Big files are never read whole** (bench JSON, logs): a script prints the summary and only that is read.
- **`docs/progress.md` is updated after every finished work item**, so a `/clear` loses nothing.

