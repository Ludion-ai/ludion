# Done 2, plumbing: from `ludion teach --public` to another machine (prepared 2026-10-13)

CLAUDE.md, "Done when" 2: `ludion teach --public` from one environment → merge → within five minutes, `ludion sync` in another environment writes the lesson with the teacher's name, and `ludion_ask` returns it.

**Run on 2026-10-13: passed** (`result.json`, written by `measure.ts`; the log is in `docs/progress.md`). The owner answered `y` to `ludion-ai@0.1.4 teach --public` as `Ludion-ai`, which opened #97 at 08:34 UTC; CI went green (`verify`, `test`), a fresh Opus review said APPROVE (comment on #97), and it was merged at 08:40:22 UTC. From that merge: `/index/vitest.json` listed the lesson after 67 s, `ludion sync` wrote it with `Taught by @Ludion-ai` after 74 s (second attempt), `ludion_ask` returned it after 75 s; the limit is 300 s. The three checks by hand (same machine, a copy of `project/`, empty `LUDION_HOME`, `ludion-ai@0.1.4` from npm) gave the same: see `by_hand` in `result.json`. One observation: the first `teach` attempt, run by an agent, stopped at "Teaching in public needs you at a terminal to confirm", as designed; the owner ran it from their own terminal.

What was learned about running it: `npx ludion-ai@0.1.4 ...` started from a checkout of the repo without `npm install` fails with "'ludion' is not recognized" (npx picks the workspace's own `ludion-ai` package, whose bin isn't linked there); start it from another folder. `sync-production-0.1.4.txt` is a separate check: `npx ludion-ai@0.1.4 sync` in an empty folder against production, with a hand-written lockfile (agents 0.20.0, vitest 5.0.0, wrangler 4.113.0, left-pad), after the npm release.

## The lesson

`draft.json`: vitest 4.0's `vi.restoreAllMocks` no longer resets the state of spies (it only restores spies made with `vi.spyOn`); versions `>=4.0.0`, kind `behavior`, signal `silent`, drafted by an agent. Evidence: a test that passes on vitest 4.0.0 and fails on 3.2.4 (the same code: a `vi.fn()` called twice, then `vi.restoreAllMocks()`, then its call count), both pinned with vite 7.1.11, and a sentence from the 4.0.0 migration guide.

Why this one: none of the pipeline's drafts that are left was both new and free of review findings (the clean ones are on main already, or repeat a lesson on main), so this one was written for the purpose, from the migration guide, and checked first:

- `ludion teach` on this machine: schema, lint, and the quote found on its page. The tests didn't run here (no Docker).
- CI, on a draft pull request holding the same lesson that was closed unmerged (#90): `verify` ran both tests in Docker with the network off and passed, `test` passed. The record is `ci.json`. It took three tries, and the first two found real problems: vitest 4.0.0 fails with "Unknown method: getBuiltins" against today's newest vite 7.x, so both tests pin vite 7.1.11; and the search-eval test failed every lesson without search questions, which no teacher's pull request can have (fixed in #91).
- A local search over the lessons plus this one finds it first for the question `measure.ts` asks.

The teacher is whichever account `gh` is signed in as when `teach --public` runs (`gh auth status`; on this machine it is `Ludion-ai`). The lesson file's `author_id` will be that account's numeric id, and CI checks it against the pull request's author.

## What the owner runs

1. Once `ludion-ai@0.1.4` is approved on npmjs.com (`npm view ludion-ai version` says 0.1.4): in a terminal, with `git pull` done in `C:\dev\ludion`:

   ```
   npx ludion-ai@0.1.4 teach C:\dev\ludion\docs\bench\2026-10-13-done2\draft.json --public
   ```

   It shows the whole lesson, then asks `[y/N]`. Answer `y` only if the lesson reads right to you. It prints the pull request's URL.

2. In a second terminal, from `C:\dev\ludion`, before merging (it waits for the merge, then times everything):

   ```
   node docs/bench/2026-10-13-done2/measure.ts <the pull request number>
   ```

3. Merge that pull request (CI must be green). **Don't merge anything else for ten minutes before or after**: deploys of older commits fail on purpose, and a newer merge would make the lesson's deploy a different one from the one measured.

## The three checks by hand (one line each, PowerShell)

An empty `LUDION_HOME` keeps your own ledger, which has the lesson from `teach`, out of it, so only the public index can supply it.

- sync in another directory: `$d="$env:TEMP\done2-b"; Remove-Item $d -Recurse -Force -EA 0; Copy-Item C:\dev\ludion\docs\bench\2026-10-13-done2\project $d -Recurse; $env:LUDION_HOME="$d\home"; npx ludion-ai@0.1.4 sync --dir $d`
- the teacher's name in `lessons.md`: `Select-String -Path "$env:TEMP\done2-b\.ludion\lessons.md" -Pattern "restoreAllMocks" -Context 0,1`
- `ludion_ask` returns it: `node C:\dev\ludion\docs\bench\2026-10-13-done2\ask.ts`

## How the five minutes are measured

`measure.ts` takes T0 from GitHub's `merged_at` of the pull request (one-second resolution), then records, as seconds after T0:

1. when `/index/vitest.json` on <https://ludion.ai> (read with a cache-busting query) first lists the lesson's id;
2. when `npx ludion-ai@0.1.4 sync` in a copy of `project/` (vitest 4.0.0 in its lockfile; empty ledger) first writes `.ludion/lessons.md` with the lesson's claim and `Taught by @<the pull request's author>` on the next line (it tries again every five seconds and records the number of attempts);
3. when `ludion_ask` over `/mcp` first returns the lesson (the question is fixed in the script, chosen before the run on a local index).

It also checks that the merged file's `author_id` is the pull request author's numeric id and `author` is `github:<login>`. Passed means all three times are 300 seconds or less and the three checks hold; the numbers are written either way. Deploys of the last merges took 46 to 86 seconds (`gh run list --workflow=deploy.yml`), so the margin is large, if the newest commit is the lesson's.

**Rehearsal** (2026-10-13, on the already merged #80, with the local CLI build, `--cli-path`, and a vitest 5.0.0 project): every step worked and `passed` was false only because that merge was 49 minutes old. It found two bugs in `measure.ts` that the first real run would have hit: `node.exe`'s path with a space under `shell: true`, and a relative `--cli-path` used from another working directory.
