# Realistic screening: Claude Code in a project, no lessons (2026-10-11)

The 45 FreshBench A questions (the 2026-10-08 questions with the verified keys of `docs/bench/2026-10-11-keys/`), each asked of Claude Code (`opus`) working inside a prepared project that has the new version installed (`tools/bench/projects/`: vitest 5.0.3, wrangler 4.148.0, agents 0.27.0 with wrangler). This is the "without sync" side of the realistic condition: Claude Code's default tools, read-only (Read, Glob, Grep, WebSearch, WebFetch, and a few read-only npm/npx commands; `projectTools(false)` in `tools/bench/src/agent.ts`), no CLAUDE.md, no lessons, no MCP. Graded by the same judge as before (`opus`, against the verified key).

Command: `node tools/bench/src/freshbench.ts run docs/bench/2026-10-11-realistic/questions.json docs/bench/2026-10-11-realistic A-project --set A --condition project --projects <cache> --cap-usd 30`, then `judge`. Cost: $3.55 for the answers, $4.74 with judging.

## Result: 14/45 correct (31%)

| | silent | loud | all |
| - | - | - | - |
| wrangler | 4/14 | 0/1 | 4/15 |
| agents | 5/9 | 4/6 | 9/15 |
| vitest | 0/9 | 1/6 | 1/15 |
| all | 9/32 | 5/13 | 14/45 |

- **Mostly it didn't look.** 29 of 45 answers used no tool at all (4 of them correct). The 4 answers that read or searched the installed package were all correct; the 13 that used the web got 7 right.
- **vitest: 1/15**, and no vitest answer opened a file. The installed vitest 5 holds every answer, but the agent answered from what it knew of vitest 4.
- For comparison (not the same setup: no project, 2026-10-08 answers, corrected keys): no tools 3/45, web search 20/45 (`docs/bench/2026-10-08/rejudge-2026-10-11/`).

This is what Done 1 and the seed lessons aim at: changes Claude Code gets wrong even with the new version on disk. Files: `questions.json`, `answers-A-project.json`, `grades-A-project.json`, `runs/`.
