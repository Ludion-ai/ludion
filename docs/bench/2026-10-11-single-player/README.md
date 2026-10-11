# Single player, first attempt: 2026-10-11

Done 1 in CLAUDE.md: a lesson taught in project A shows up via `ludion sync` in project B, and Claude Code in B gets right the task it got wrong before. **The plumbing works, but this task does not show the second half:** Claude Code got the task right before the lesson as well, because it found the answer itself.

## What was run

- **The lesson**: vitest 5's `junit` reporter now writes its report to `.vitest/junit/output.xml` by default. In vitest 4 it went to stdout unless `outputFile` was set.
  - It was checked by hand first: in a scratch project, `vitest run --reporter=junit` wrote `.vitest/junit/output.xml` on 5.0.3 and printed to stdout on 4.1.11.
  - It was taught in project A with `ludion teach junit-lesson-draft.json`, the CLI run from source.
  - Both sources were found by `checkSource`: two sentences from https://vitest.dev/guide/reporters.
  - Docker isn't installed here, so the lesson has no test; it went to a ledger in a scratch `LUDION_HOME`.
- **Project B**: vitest 5.0.3 installed, a small module and its test. For "after", `ludion sync --offline` (the bundled CLI) wrote `.ludion/lessons.md` with the lesson and imported it from `CLAUDE.md`.
- **Agent**: Claude Code 2.1.294 headless, `--model opus` (claude-opus-5-5), in a fresh copy of B for each run.
  - Default tools: Bash limited to npm, npx, node, ls, cat, find, and git; file tools; web search and fetch.
  - `--permission-mode acceptEdits`, `--setting-sources project`, and no MCP servers.
  - Grading is by script: `run.mjs` and `regrade.mjs` in each folder.

## Results

**CI task** (`ci-task/`): "add a GitHub Actions workflow that runs Vitest with the junit reporter and uploads the JUnit XML with actions/upload-artifact; keep the default report location."

| | before | after `ludion sync` |
| - | - | - |
| Uploads vitest's default path (`.vitest/junit/output.xml`) | 5/5 | 5/5 |
| Strictly correct (the path, plus `include-hidden-files: true`, without which upload-artifact skips the hidden `.vitest/` and uploads nothing) | 4/5 | 2/5 |

The first grading counted an `outputFile` that only appeared in comments as "configured an output file". That gave a false 0/5 before; `regrade.mjs` fixes it and the table uses the regrade. The strict misses are about `actions/upload-artifact`, not vitest, and `ludion sync` can't match that from a lockfile.

**Copy task** (`copy-task/`): "add an npm script test:report that runs Vitest with the junit reporter and copies the report to reports/junit.xml."

| | before | after `ludion sync` |
| - | - | - |
| Copies `.vitest/junit/output.xml` | 5/5 | 5/5 |

Cost: $2.28 for the CI task and $1.83 for the copy task, 20 runs in all.

## What it showed

- **The plumbing works**: teach in A, a ledger, sync in B, then `.ludion/lessons.md` imported by CLAUDE.md. The agents read it: several after-runs say they took the path from "the project's lessons note" and then confirmed it.
- **The task was the wrong kind for the second half.** With default tools and vitest installed, Claude Code read vitest's code or ran the suite and saw where the file went. A change the agent can observe by running the project is one it fixes itself. That is the CLAUDE.md point that failures which make noise get fixed in the agent's own loop.
- **Next**: screen changes under the same realistic conditions, and pick ones the agent gets wrong with its default tools: changes it can't observe locally (platform behavior, a deprecated call that still runs, a weaker default), or ones it has no reason to check. The realistic FreshBench (Done 3) needs the same screening.

## Safety note

These runs gave the agent broad Bash (`npx`, `npm`, `node`, `cat`, `find`, `git`) together with edit permission, on this machine. That was too much for an agent that reads web pages and package code: an injected instruction could have used it. The `run.mjs` files are kept as a record and say not to run them again. The bench's project condition in `tools/bench/src/agent.ts` never gives both write and run: questions get read-only tools plus the project's own tests, and tasks get edits with no Bash. The environment passed to the run is scrubbed of tokens.

## Files

- `junit-lesson-draft.json`: the draft taught in project A.
- `ci-task/`, `copy-task/`:
  - `run.mjs`: the harness and grader;
  - `results.json`: the first grading;
  - `regraded.json` (CI task only): the fixed grading;
  - `*-ci.yml` or `*-package.json`: what each run wrote;
  - `*.jsonl`: each run's raw log.
- Local paths and the account name are replaced with `~` and `user`.
