# C tasks

Realistic coding tasks for the official Done 3 measurement (`docs/decisions.md`, "Measuring Done 3"). Each folder is one task: `task.json` holds the prompt, the grading rules, and a correct and a stale example solution. `files/` is copied over the prepared project (`tools/bench/projects/<library>`, packages installed) before the run.

- **Written independently of the lessons**: three authors, one per library, worked from the verified answer keys (`docs/bench/2026-10-11-keys/keys.json`) and the real packages only. They didn't read the seed lessons, `lessons/`, the FreshBench questions, or any run log. Prompts never name the answer or say that something changed.
- **Graded without running anything**: `tools/bench/src/rule-tasks.ts` reads the files the agent left. A task is correct when every rule of one alternative holds, and wrong otherwise. JS/TS comments (and `#` comments in TOML/YAML) are dropped first, so a comment can't satisfy a rule. String literals stay whole.
- **Checked**: `tools/bench/test/bench.test.ts` requires every task's correct examples to grade correct, its stale examples to grade wrong, and the untouched project to grade wrong.
- **Reviewed**: a fresh-context reviewer per library checked every trap against the installed package, the prompt's fairness, and the rules (27 findings over the three libraries: rules that rejected correct solutions, matches that ran past a script's value, one prompt that echoed the docs, and others). All were applied before any measurement. The comment stripper's string handling came from the vitest review.

**35 tasks**: vitest 11, wrangler 12, agents 12. Changes without a task, with the author's reason:
- vitest-5-0-0-6: nothing changed for users.
- vitest-5-0-0-15: depends on run-time timing.
- vitest-5-0-0-17 and vitest-5-0-0-20: new options only, so the old way stays correct.
- wrangler-4-121-0-6: the old opt-outs still work.
- wrangler-4-116-0-16: telling the versions apart needs running the command.
- wrangler-4-117-0-20: the old paths are rewritten, so they still work.
- agents-0-22-0-9 and agents-0-22-0-12: ordinary code is the same either way.
- agents-0-20-0-19: internal to the client.

vitest-5-0-0-14-c resembles the Done 1 task (`tools/bench/tasks/vitest-extends`): same change, different project and goal. Done 1 isn't part of Done 3.

Run: `node tools/bench/src/tasks-run.ts <projects cache> <out dir> <label> [--only id,id] [--sync <ludion cli.js> --site <url>]`. One trial per task. A batch stops at an error that isn't the run's own turn or dollar limit (the plan's session limit, for example), saves nothing for that run, and the same command continues from there, on another day if needed.
