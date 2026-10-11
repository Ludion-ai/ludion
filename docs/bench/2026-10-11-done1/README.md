# Done 1, single player (2026-10-11)

CLAUDE.md, "Done when" 1: a lesson taught in project A shows up via `ludion sync` in B, and Claude Code in B gets right the task it got wrong before.

## The change and the task

vitest 5 made inline projects inherit the root config by default (`extends` is on unless set to `false`; vitest 5.0.3 source: `inheritsParentConfig = isInlineEntry && options.extends !== false && typeof options.extends !== "string"`). Code written for vitest 4, where an inline project inherited nothing without `extends: true`, still runs without an error. It just picks up the root's options. It was 0/9 for vitest's silent changes in the realistic screening (`../2026-10-11-realistic/`).

Project B is the prepared vitest 5.0.3 project plus `tools/bench/tasks/vitest-extends/`. Its config is written the vitest 4 way: a root `setupFiles` entry that starts a test database, and one `integration` project with `extends: true`. The task (`tools/bench/src/tasks.ts`) asks for a `unit` project that must not run the database setup. In vitest 5, a `unit` project without `extends: false` inherits the setup file. Running exactly that config confirmed it: `vitest run --project unit` fails in the database setup, and with `extends: false` the unit test passes.

**Grading** reads the config the agent left and never runs it: correct if the `unit` project has `extends: false`, or the root no longer lists `test/setup-db.ts`. An empty `setupFiles` doesn't count, because arrays are concatenated. Grader tests are in `tools/bench/test/bench.test.ts`. Every config the agent wrote is in `runs/` and was also read by hand.

**Agent**: Claude Code (`opus`), working in a copy of project B with edit tools and no shell (`projectTools(true)`: Read, Glob, Grep, Edit, Write, WebSearch, WebFetch). It reads untrusted text, so it never gets both a way to write files and a way to run them. Up to 25 turns, $2 per run.

## The lesson

Taught in project A: `ludion teach lesson-draft.json --drafted-by-agent`, into a fresh ledger (`LUDION_HOME`). Checks: schema, grounding, and symbol pass; both quotes were found on <https://vitest.dev/guide/projects>; no tests. Generated claim: "vitest >=5.0.0 changed the default of `extends`. Projects defined with an inline configuration inherit all options from the root-level configuration; add extends: false to ignore the options. Silent: code written for older versions still runs, without an error."

## Results

| | correct | how B got the lesson |
| - | - | - |
| before (no sync) | **1/5** | none |
| after `ludion sync --offline` in B | **5/5** | `.ludion/lessons.md`, imported from CLAUDE.md |
| plugin hook, B never synced | **3/3** | the SessionStart hook ran `sync --quiet`; its output reached the session |

- **Before**, 4 of 5 runs left `extends` out. One run wrote its reasoning into the config: "No `extends: true`, so the root setupFiles (database setup) is not inherited." The one correct run found `extends` by grepping `node_modules`.
- **After**, all 5 runs added `extends: false`.
- **Plugin hook**: a local copy of `plugin/` whose hook runs the same CLI bundle (`node cli.js sync --quiet --offline`) instead of `npx ludion@0.1.0`, which isn't published yet. Each log has a `hook_response` message carrying the lessons (`runs/hook-*.jsonl`).

Commands: `node tools/bench/src/done1.ts <projects cache> <cli.js> <ludion home> docs/bench/2026-10-11-done1 --trials 5` and `node tools/bench/src/done1-hook.ts … --trials 3`. The CLI is `packages/cli` from the `claude-plugin` branch, built with `npm run build -w ludion`. Cost: $1.26 + $0.41. Files: `summary.json`, `summary-hook.json`, `runs/`, `lesson-draft.json`, `ledger-entry.json`, `lessons.md` (what sync wrote in B).

Limits: one task, small samples (5, 5, 3). The agent had no shell, so it couldn't run the tests. With a shell, this project's stub database would throw (a real one would just run, slowly), so a careful agent might notice.
