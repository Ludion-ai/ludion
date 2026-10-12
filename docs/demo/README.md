# Demo: what changed, and teaching what you learned (89 seconds)

`sync-vitest.cast` is an asciinema recording built only from recorded output (`node docs/demo/make-cast.ts`). Play it with `asciinema play docs/demo/sync-vitest.cast`; GitHub shows the file as raw JSON, so for a page that plays it, upload it to asciinema.org. The `claude -p` lines stand for recorded runs; the cast replays their answers and calls no model.

What is typed in the cast and what was run differ in these ways:

- The cast types `npx ludion-ai sync` and `npx ludion-ai teach`. The recordings ran the CLI built from this repository with `node packages/cli/src/cli.ts`, because the version that has what the cast shows (0.1.3 and later: the coverage line, the `unverified` and "not verified" labels) wasn't on npm when they were recorded.
- The second project is typed as `cd ../demo-project-b`; that is its real folder name (its package is called `billing-service`).

**Act 1: vitest 5, without and with `ludion sync`**

- the question and both answers: the Done 3 B runs (`docs/bench/2026-10-11-done3/`, question `vitest-5-0-0-14-b`), Claude Code (`claude-opus-5-5`) with its read-only tools in a project with vitest 5.0.3 installed. Without sync the answer was graded wrong; with sync, correct. The with-sync answer was recorded with the lessons as frozen on 2026-10-11, served from a local build; the `sync` output shown is from running `ludion sync` against <https://ludion.ai> on 2026-10-12. The lesson's text is the same in both.
- `deps-output.txt`: the real output of `grep vitest package.json` in that project (`tools/bench/projects/vitest`). `sync-output.txt` and `grep-output.txt`: `ludion sync` run in a copy of the project against ludion.ai.

**Act 2: teach once, another project gets it**

- `teach-output.txt`: `ludion teach` run on 2026-10-13 on the draft for vitest 4.0's `vi.restoreAllMocks` change (`docs/bench/2026-10-13-done2/draft.json`: a test that passes on 4.0.0 and fails on 3.2.4, and a sentence from the 4.0 migration guide). The 42 lines of each test's code are replaced by one line saying how many were left out; nothing else is changed. Docker isn't installed on the machine that recorded it, so the output says the tests did not run there. CI ran the same tests on a draft pull request that was never merged (#90); its result is in `docs/bench/2026-10-13-done2/ci.json`.
- `sync2-output.txt` and `grep2-output.txt` (`grep -A1`, so the line under the claim shows): `ludion sync` in a second project with vitest 4.0.0 installed, against ludion.ai, with the same personal ledger. The second line says "Taught by you (in your ledger, not public), drafted by an agent; not verified: tests not run (Docker isn't installed here; CI runs them), sources found".
- `teach --public` is not in the recording: it needs the teacher's own terminal and `gh`, and it hasn't been recorded yet (`docs/progress.md`, Done 2). When it has, act 2 should be replaced by that run.
