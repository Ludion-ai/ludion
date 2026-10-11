# Done 3, value: realistic FreshBench with vs without sync (2026-10-11)

CLAUDE.md, "Done when" 3: FreshBench on the wedge under realistic conditions, with `ludion sync` vs without. +20 points passes. Method: `docs/decisions.md`, "Measuring Done 3".

## Frozen seeds

Measured on the seeds as frozen at commit `7d61ed1` (the `seeds` branch, #36): 31 seed lessons, after every finding of their review was fixed and CI's `verify` passed. "With sync" ran `ludion sync` with the CLI built from that commit (`packages/cli`, `npm run build -w ludion`) against the site built from it and served locally (`LUDION_SITE=http://127.0.0.1:8791`), with an empty ledger (`LUDION_HOME`). Each lesson line was what the public site will serve: teacher, "drafted by an agent", and the verified label. `seeds.json` maps each change to its seed (31 seeds; `wrangler-4-145-0-11-token` is the token rename split out of the `basin sql` seed).

These are the official Done 3 results for the B questions. A measurement repeated after a seed is changed is reference only.

## B questions: 36/45 with sync, 24/45 without (+27 points)

| | without sync | with sync |
| - | - | - |
| changes a seed covers (30) | 16/30 | 28/30 |
| changes no seed covers (15) | 8/15 | 8/15 |
| all (45) | **24/45 (53%)** | **36/45 (80%)** |

- **Setup**: the 45 B questions (one per change), the verified keys (`../2026-10-11-keys/`), Claude Code (`claude-opus-5-5`) with its default read-only tools in the prepared projects with the new versions installed. The same opus judge as before graded the answers against the keys.
- On uncovered changes the score didn't move (two gains, two losses), so the gain comes from the lessons.
- 15 questions went from wrong to right with sync, 3 from right to not right. Judging: `grades-*.json` holds each grade with its reason.
- Commands: `node tools/bench/src/freshbench.ts run docs/bench/2026-10-11-done3/questions.json docs/bench/2026-10-11-done3 <label> --set B --condition project --projects <cache> --model claude-opus-5-5 [--sync <cli.js>] --cap-usd 40`, then `judge`. Cost: $11.06 for both runs with judging ($5.27 without sync, $5.79 with).

## Harm check

A seed whose own wording makes an answer worse isn't published (`docs/decisions.md`). `node tools/bench/src/harm.ts docs/bench/2026-10-11-done3` lists every change that scored lower with sync; each was read by hand:

| change | without → with | the change's seed | cause |
| - | - | - | - |
| wrangler-4-113-0-21 ("Is automatic resource provisioning still in beta?") | correct → no answer | `01M4N4KZ0Z156GTD76SM9E7DXQ` (`deploy`: provisioning expands to Queue, Dispatch Namespace and Flagship bindings) | **the seed.** It states half the change and leaves out that provisioning is generally available. Without it, the agent searched the web and found that it is. With it, the agent searched only the installed package, repeated the lesson, said nothing there told whether the feature is still beta, and declined to answer. The seed says nothing false; it made the agent stop looking. One trial per condition. In the value preview, the same seed's earlier wording also led to a wrong answer. **Withheld from #36.** |
| agents-0-25-0-3 (RPC with `idFromString()`) | correct → wrong | none | no seed for this change; the answer cites no lesson. Run-to-run variation. |
| vitest-5-0-0-16 (`vi.mock` in `beforeEach`) | correct → wrong | none | no seed for this change; the answer says the lessons file doesn't mention it. Run-to-run variation. |

Not a loss, but read too: wrangler-4-145-0-11 went from wrong to no answer with its seed (`wrangler r2 sql` renamed to `wrangler basin sql`). The answer got the rename and the token right from the seed, and said it couldn't tell where `wrangler pipelines` went, which the seed doesn't cover. Nothing in it is false, so the seed stays.

## C tasks: not measured yet

The first attempt (three trials per task, both conditions in one batch) hit the plan's session limit after six agents tasks: 89 runs without sync and 87 with sync ended with "You've hit your session limit" and were never graded. **Those rows and their logs were removed.** What's left: the first six agents tasks, all correct both ways (`tasks-C-*.json`, `runs/C-*`). Trials 2 and 3 of those six are kept as data but not counted.

From here, one trial per task (`tasks-run.ts` now defaults to `--trials 1`), spread over several days. `tasks-run.ts` saves after every run, never saves a run that ended on an error other than its own turn or dollar limit, stops the batch at that error, and continues from where it stopped when the same command runs again. Run the same tasks under both conditions on the same day (`--only`), so a day's conditions match.

Files: `questions.json`, `answers-B-*.json`, `grades-B-*.json`, `tasks-C-*.json`, `seeds.json`, `runs/` (answer and judge logs; C task logs).
