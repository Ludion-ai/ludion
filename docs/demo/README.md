# Demo: what changed, and teaching what you learned (89 seconds)

`sync-vitest.cast` is an asciinema recording built only from recorded output (`node docs/demo/make-cast.ts`). Play it with `asciinema play docs/demo/sync-vitest.cast`, or upload it to asciinema.org. The `claude -p` lines stand for recorded runs; the cast replays their answers and calls no model.

**Act 1: vitest 5, without and with `ludion sync`**

- the question and both answers: the Done 3 B runs (`docs/bench/2026-10-11-done3/`, question `vitest-5-0-0-14-b`), Claude Code (`claude-opus-5-5`) with its default tools in a project with vitest 5.0.3 installed. Without sync the answer was graded wrong; with sync, correct.
- `sync-output.txt` and `grep-output.txt`: `ludion sync` (built from main on 2026-10-12) run in a copy of that project against <https://ludion.ai>.

**Act 2: teach once, another project gets it**

- `teach-output.txt`: `ludion teach` run on 2026-10-13 on the draft for vitest 4.0's `vi.restoreAllMocks` change (a test that passes on 4.0.0 and fails on 3.2.4, and a sentence from the 4.0 migration guide). The 42 lines of each test's code are replaced by one line saying how many were left out; nothing else is changed. Docker isn't installed on the machine that recorded it, so its output says the tests did not run there; CI ran the same tests on a draft pull request (not merged) and they passed.
- `sync2-output.txt` and `grep2-output.txt`: `ludion sync` in a second project with vitest 4.0.0 installed, against <https://ludion.ai>, with the same personal ledger. The lesson is marked there as taught by you, drafted by an agent, and not verified (the tests did not run on that machine).
- `teach --public` is not in the recording: it needs the teacher's own terminal and `gh`, and it hasn't been recorded yet (`docs/progress.md`, Done 2). When it has, act 2 should be replaced by that run.
