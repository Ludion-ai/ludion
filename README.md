# Ludion

Ludion tells AI coding assistants what changed in the software they use: only the changes for the versions a project actually installed, minus what the assistant's model is measured to know (when sync is told the model). Every lesson is checked by a machine (a test run in Docker across versions, or a quote found on its source page) and signed by the GitHub account that taught it.

A model learns once; software keeps changing. A change that makes noise (an error, a failing test) gets fixed by the assistant's own run loop. A change that makes none (a new default, a different return value, a deprecated call that still runs) ships. That is where Ludion helps.

```sh
npx ludion-ai sync
```

`sync` reads the lockfile, fetches the lessons for the installed versions from <https://ludion.ai>, and writes `.ludion/lessons.md`, imported from `CLAUDE.md` (and named in `AGENTS.md` and a Cursor rule when the project has them). In Claude Code, the plugin runs it at the start of every session and adds the MCP server (`ludion_ask`):

```
/plugin marketplace add Ludion-ai/ludion
/plugin install ludion@ludion
```

A 47-second replay of one recorded run, without and with `sync`, is in [`docs/demo/sync-vitest.cast`](docs/demo/sync-vitest.cast) (`asciinema play docs/demo/sync-vitest.cast`; built from the recorded output by `docs/demo/make-cast.ts`).

## What it measured

All numbers below come from runs whose files are in [`docs/bench/`](docs/bench/).

**With vs without `ludion sync`** (2026-10-11, [`docs/bench/2026-10-11-done3/`](docs/bench/2026-10-11-done3/)). Claude Code (`claude-opus-5-5`) with its default tools, web search included, in projects with the new versions installed, answering 45 questions about changes in vitest 5.0, wrangler 4.111 to 4.148, and the Cloudflare Agents SDK 0.19 to 0.27. An opus judge graded each answer against an answer key checked against primary sources. The lessons were the 31 seeds frozen at commit `7d61ed1`, covering 30 of the 45 changes.

| | without sync | with sync |
| - | - | - |
| changes a lesson covers (30) | 16/30 | 28/30 |
| changes no lesson covers (15) | 8/15 | 8/15 |
| all 45 | **24/45** | **36/45** |

The whole gain came from changes a lesson covers; the others didn't move. One trial per question per condition. The coding-task half of this check (C tasks) is still being run, one batch a day.

**A correction that survives** (2026-10-11, [`docs/bench/2026-10-11-done1/`](docs/bench/2026-10-11-done1/)). A vitest 5 lesson taught in one project reached another through `ludion sync`. Claude Code then did the task right 5 times out of 5, against 1 out of 5 before.

**What models know without tools** (2026-10-11, [`docs/bench/2026-10-11-models/`](docs/bench/2026-10-11-models/)). Claude Haiku, Sonnet, and Opus 5.5 each answered the same 45 changes twice with no tools: 3 to 5 right out of 45 per trial.

## What it holds today

30 lessons for vitest, wrangler, and the Cloudflare Agents SDK, plus one example lesson: the measured seeds, less one the harm check withheld (its wording made an answer worse), with two corrected by replacing lessons. All 30 were drafted by an agent, are labeled "drafted by an agent" wherever they appear, and are signed by the account that opened their pull request. Ludion holds some changes of some packages: a missing lesson is no evidence that nothing changed. From the next release of `ludion-ai`, `sync` also names the direct dependencies Ludion has no lessons for, and says where to ask for them.

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

Code: Apache-2.0 ([LICENSE](LICENSE)). Lessons: CC BY 4.0 ([LICENSE-LESSONS](LICENSE-LESSONS)).
