# Per-model FreshBench: which changes each model knows (2026-10-11)

CLAUDE.md asks FreshBench to say, per model and per lesson, which changes each model gets wrong, so `ludion sync` can leave out what a model already knows. This run measures it for the three current Claude models.

**Method**: each model answered every change's A question (45 changes in vitest, wrangler and the Agents SDK) **twice, without tools** (`claude -p`, no tools, its own model id). An `opus` judge graded each answer against the verified key (`docs/bench/2026-10-11-keys/`), with the same prompt as before. A model **knows** a change when both of its answers were graded correct; otherwise it **misses** it. An answer that errored counts as a miss. That keeps pruning conservative: a lesson is left out only when the model got it right twice.

Order: Haiku, then Sonnet, then Opus (Opus last). Command: `node tools/bench/src/freshbench.ts run … A-none-<model>-<trial> --set A --condition none --model <model>`, then `judge`. Cost: $12.41 for all six runs with judging.

| model | trial 1 | trial 2 | knows (both right) |
| - | - | - | - |
| Claude Haiku 5.5 (`claude-haiku-5-5`) | 4/45 | 5/45 | 4: wrangler-4-113-0-21, agents-0-24-0-5, vitest-5-0-0-4, vitest-5-0-0-15 |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | 5/45 | 3/45 | 3: agents-0-24-0-5, agents-0-22-0-12, vitest-5-0-0-15 |
| Claude Opus 5.5 (`claude-opus-5-5`) | 3/45 | 4/45 | 3: agents-0-24-0-5, agents-0-22-0-12, vitest-5-0-0-15 |

- All three models miss nearly every change in the wedge without tools, so pruning will leave out little for now.
- Some yes/no questions can be guessed right twice. For example, Haiku "knows" vitest-5-0-0-4 ("no longer searches parent directories") and wrangler-4-113-0-21. Such a verdict prunes a lesson that may still help. The rule stays at "both right", and these cases are listed so they can be rechecked with a third trial or another question.
- Errors (no answer): Sonnet 1 and Opus 3 across the two trials. They count as misses.

`docs/bench/models.json` maps these verdicts onto the seed lessons' ids once the seeds are final (one lesson per change). Files: `questions.json`, `answers-A-none-<model>-<trial>.json`, `grades-A-none-<model>-<trial>.json`, `runs/`.
