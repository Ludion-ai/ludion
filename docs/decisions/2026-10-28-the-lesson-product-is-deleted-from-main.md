## 2026-10-28 — The lesson product is deleted from main

Cleanup PR-C in `docs/design.md`. Main at `3bd1de1` is tagged `archive/lessons-2026-10-27`; everything below can be restored from it, except the last edits #137–#139 made to six files before deleting them (`tools/verify/src/{docker,cli,pr-cli}.ts`, `tools/verify/test/docker.test.ts`, `packages/cli/src/teach.ts`, `tools/seed/src/steps.ts`): those are in main's history before PR-C.

Deleted: `packages/core`, `packages/capability`, `tools/seed`, `tools/bench`, `tools/verify`, `lessons/`, `LICENSE-LESSONS`, `plugin/`, `.claude-plugin/`, `video/`, the CLI's `sync` and `teach` (ledger, match, publish, render, shards, teach), the site's lesson data, design samples and index pages, the Worker's MCP server and index counting, the `reverify`, `seed-watch` and `verify` workflows, and the docs except `decisions.md`, `progress.md`, `design.md`, `protected-paths.md` and the two 2026-10-27 security evidence folders (they are the new product's evidence).

Two departures from the design's PR split:

- **The Worker's "ended" answer is in this PR, not PR-D.** The Worker's `/mcp` and `/index/*` were built from `packages/core` and the lessons, so they could not survive the deletion. `/mcp`, `/mcp/*`, `/index.json` and `/index/*` now answer 410 with `{"error":"ended", "message": ...}` and CORS `*`, so a 0.1.x client fails with a reason. These routes go after 90 days (2027-01-26). `/@<login>` and the old lesson URLs still redirect to `/start/`. The `INDEX_HITS` Analytics Engine binding is removed with the counting.
- **The CLAUDE.md sentences that promised compatibility are changed here too**, since this PR is what ends it. The rest of the CLAUDE.md rewrite is PR-D.

`ludion sync` and `ludion teach` print that they ended and exit 2. The 0.1.x plugin pinned its exact CLI version, so its session hook keeps running 0.1.x, gets the 410, and leaves the existing lessons file as it was (that version's behaviour on a fetch failure).

The deploy check (`tools/check-production.ts`) now waits for `/build.json` (a new build-time marker) instead of `index.json`, checks that `/` answers 200, and checks that `/index.json` and `/mcp` answer the 410.

The repository guard on starting containers now scans `tools/`, every `packages/*/src` and every `apps/*/src` (before: `tools/verify/src` and `packages/*/src`), and `packages/sandbox/src/docker.ts` is its only builder. `tools/verify/` and `lessons/` stay in the protected-path pattern, so bringing either back needs the same review.

The required status check `verify` is gone with its workflow. Branch protection on main still lists it, so this PR cannot merge until the owner removes `verify` from the required checks.

