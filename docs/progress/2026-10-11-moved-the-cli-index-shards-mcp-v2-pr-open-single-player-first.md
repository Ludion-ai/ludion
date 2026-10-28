### 2026-10-11: The CLI, index shards, MCP v2 (PR open); single player, first attempt

- Built: `ludion sync` (lockfiles, shards, the ledger, model pruning, CLAUDE.md, AGENTS.md, and Cursor wiring, writes kept inside the project), `ludion teach` (checks, ledger, `--public` through `gh`), `/index/subjects.json` and `/index/<subject>.json`, the `ludion_ask` data line, and the new `ludion_teach`.
- Check: a vitest junit lesson taught in project A reached project B through `ludion sync`, and the agents read it. **Done 1 is not shown yet**, because the agent got the task right before the lesson too: it found the path by running vitest (5/5 before and after, `docs/bench/2026-10-11-single-player/`).
- Decided: pick Done 1 and Done 3 tasks by screening changes under realistic conditions (default tools, package installed). A change the agent can observe by running the project isn't where Ludion helps; silent changes it can't observe are.
- The WebdriverIO answer key was checked against vitest's docs: the provider is community-maintained, not removed. All 45 keys are being checked against primary sources.

