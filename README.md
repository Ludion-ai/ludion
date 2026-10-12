# Ludion

Ludion tells AI coding assistants what changed in the software they use: only the changes for the versions a project actually installed, minus what the assistant's model is measured to know (when sync is told the model). Every lesson is checked by a machine (a test run in Docker across versions, or a quote found on its source page) and signed by the GitHub account that taught it.

A model learns once; software keeps changing. A change that makes noise (an error, a failing test) gets fixed by the assistant's own run loop. A change that makes none (a new default, a different return value, a deprecated call that still runs) ships. That is where Ludion helps.

```sh
npx ludion-ai sync
```

`sync` reads the lockfile, fetches the lessons for the installed versions from <https://ludion.ai>, and writes `.ludion/lessons.md`, imported from `CLAUDE.md` (and named in `AGENTS.md`, and written into a Cursor rule, when the project has them). In Claude Code, the plugin runs it at the start of every session and adds the MCP server (`ludion_ask`):

```
/plugin marketplace add Ludion-ai/ludion
/plugin install ludion@ludion
```

An 89-second replay of recorded runs is in [`docs/demo/sync-vitest.cast`](docs/demo/sync-vitest.cast) (`asciinema play docs/demo/sync-vitest.cast`). It shows one question answered without and with `sync`, then a lesson taught with `ludion teach` and written by `sync` in another project. It is built from recorded output by `docs/demo/make-cast.ts`, and [`docs/demo/README.md`](docs/demo/README.md) says what was recorded when and what was left out.

## What it measured

All numbers below come from runs whose files are in [`docs/bench/`](docs/bench/).

**With vs without `ludion sync`** (2026-10-11, [`docs/bench/2026-10-11-done3/`](docs/bench/2026-10-11-done3/)). Claude Code (`claude-opus-5-5`) with its read-only tools (read, search, web search and fetch, and a few fixed commands such as `npm ls`), in projects with the new versions installed, answering 45 questions about changes in vitest 5.0, wrangler 4.111 to 4.148, and the Cloudflare Agents SDK 0.19 to 0.27. An opus judge graded each answer against an answer key checked against primary sources. The lessons were the 31 seeds frozen at commit `7d61ed1`, covering 30 of the 45 changes.

| | without sync | with sync |
| - | - | - |
| changes a lesson covers (30) | 16/30 | 28/30 |
| changes no lesson covers (15) | 8/15 | 8/15 |
| all 45 | **24/45** | **36/45** |

The whole gain came from changes a lesson covers; the others didn't move. One trial per question per condition. The coding-task half of this check (C tasks) is still being run, one batch a day.

**A correction that survives** (2026-10-11, [`docs/bench/2026-10-11-done1/`](docs/bench/2026-10-11-done1/)). A vitest 5 lesson taught in one project reached another through `ludion sync`. Claude Code then did the task right 5 times out of 5, against 1 out of 5 before (one task, and the agent had no shell).

**What models know without tools** (2026-10-11, [`docs/bench/2026-10-11-models/`](docs/bench/2026-10-11-models/)). Claude Haiku, Sonnet, and Opus 5.5 each answered the same 45 changes twice with no tools: 3 to 5 right out of 45 per trial.

## What it holds today

Lessons for vitest, wrangler, and the Cloudflare Agents SDK (the live list is on <https://ludion.ai>, and `/index/subjects.json` has the counts of the format 1 lessons), plus one example lesson for Python. Every lesson but the example was drafted by an agent, is labeled "drafted by an agent" wherever it appears, and is signed by the GitHub account that opened its pull request.

Ludion holds some changes of some packages: a missing lesson is no evidence that nothing changed. `ludion-ai` 0.1.3 and later `sync` name the direct dependencies Ludion has no lessons for, and say where to ask for them.

## Teach one

```sh
npx ludion-ai teach draft.json            # checks it here, saves it to your ledger (~/.ludion)
npx ludion-ai teach draft.json --public   # shows you the whole lesson, then opens a pull request with your own gh
```

When your assistant gets a change wrong, ask it to draft the lesson with the `ludion_teach` MCP tool; it returns the command to run. A draft can also be written by hand: it has the fields of a lesson file (see any file in [`lessons/`](lessons/) and [`lessons/lessons.schema.json`](lessons/lessons.schema.json)) without the id, author and dates, which `teach` sets. Its evidence is a test that passes on the new version and fails on the one before (it runs in Docker with the network off, on your machine if Docker is installed and in CI either way), or a quote from the source that states the fact. A draft with no evidence stays in your ledger, marked "unverified, yours only", and never reaches anyone else. Nothing is published unless you confirm at your own terminal.

## How a lesson works

- **Claims are generated, not written.** The sentence an assistant reads is built from structured fields: package, versions, kind (removed, renamed, deprecated, added, default, behavior), symbol, and whether the change is silent. The only free text is a short detail, every meaningful word of which must appear in the evidence.
- **Verified means verified.** Evidence is a test (preferably the same code passing on the new version and failing on the one before, run in Docker with the network off) or a quote that states the fact on its source page. CI checks each lesson in its pull request, and a nightly job checks all of them again; a lesson that fails leaves the index.
- **The person signs.** A public lesson is a pull request opened from the teacher's own GitHub account, after they saw the whole lesson. `ludion teach` saves a lesson to a personal ledger first (`~/.ludion`); `--public` opens the PR with the teacher's own `gh`.
- **Lessons are immutable.** A correction is a new lesson that replaces the old one; a retraction deletes the file and leaves a tombstone page.
- **Lessons are data, never instructions**, and every list of them says so.

## This repository

- `lessons/`: one JSON file per lesson. `main` is the truth: only lessons on main are served.
- `packages/core`: the schema, generated claims, search, source checks, and the index builder.
- `packages/cli`: the `ludion-ai` CLI (`sync`, `teach`). No telemetry.
- `apps/site`, `apps/worker`: <https://ludion.ai>, `/index.json`, the per-subject shards, and `/mcp`.
- `tools/verify`: CI's lesson checks; `tools/bench`: FreshBench.
- `plugin/`: the Claude Code plugin.
- `docs/decisions.md`: every decision and why; `docs/progress.md`: what was built and what the checks showed.

Code: Apache-2.0 ([LICENSE](LICENSE)). Lessons: CC BY-SA 4.0 ([LICENSE-LESSONS](LICENSE-LESSONS)).
