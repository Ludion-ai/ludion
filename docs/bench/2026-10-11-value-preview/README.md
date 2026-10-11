# Value preview: realistic FreshBench with vs without sync (2026-10-11)

A preview of CLAUDE.md "Done when" 3, run before the seed lessons are public. This is not the Done 3 measurement: that one syncs from the deployed index after the seeds merge.

> **Reference only.** It was measured on the A questions, which the seeds were drafted from, and seeds were rewritten after the measurement. The official Done 3 measurement freezes the seeds first, then measures on the B questions and the C tasks, never the A questions. A measurement on the frozen seeds is the official one; one repeated after a seed is changed is reference only (`docs/decisions.md`, "Measuring Done 3"). The official B result is in `../2026-10-11-done3/`.

**Setup**: the same 45 A questions, keys, model (`opus`), tools, and prepared projects as the realistic screening (`../2026-10-11-realistic/`, "without"). The one difference: before each run, `ludion sync --offline` wrote the 29 seed lessons drafted that day into the project (`.ludion/lessons.md`, imported from CLAUDE.md), from a local ledger. The ledger is in `ledger/`: those drafts as they were, before the rewording below. Because they came from a ledger, each lesson's line said "not verified: tests not run" rather than "verified". The answers were graded by the same judge.

Command: `node tools/bench/src/freshbench.ts run docs/bench/2026-10-11-value-preview/questions.json docs/bench/2026-10-11-value-preview A-project-sync --set A --condition project --projects <cache> --sync <ludion cli.js> --ludion-home <seed ledger home> --offline true --cap-usd 30`, then `judge`. Cost: $4.50 for the answers, $5.69 with judging.

## Result: 34/45 with sync, 14/45 without (+44 points)

| | without sync | with sync |
| - | - | - |
| changes a seed covers (29) | 7/29 | 26/29 |
| changes no seed covers (16) | 7/16 | 8/16 |
| all (45) | 14/45 (31%) | 34/45 (76%) |

- On uncovered changes the score barely moved (+2, −1), so the gain comes from the lessons, not from the setup.
- **The three covered misses were all the seeds' wording**, and each seed was reworded afterwards:
  - `-t` (vitest-5-0-0-13): the detail couldn't name the ` > ` separator, because details refused `>`. The agent answered "joined by spaces", the old behavior. Details now allow a lone `>`, and the lesson says "joins … with ' > '".
  - `transport` (agents-0-24-0-6): "the default cf-websocket, a hibernating WebSocket, or the experimental capnweb" read as three transports, and the agent listed three. It got this right without the lesson: **a misleading lesson made the answer worse.** The lesson now says "one of two wires: cf-websocket (the default, a hibernating WebSocket) or …".
  - `deploy` (wrangler-4-113-0-21): the generic detail didn't say queues are now provisioned, so the agent said "probably not". It now names Flagship, Dispatch Namespaces and Queues.
- The agent often said where its answer came from ("from your project's `.ludion/lessons.md`, marked not verified") and hedged because of that label. Public lessons carry "verified" labels.

Files: `questions.json`, `answers-A-project-sync.json`, `grades-A-project-sync.json`, `runs/`, `ledger/`.
