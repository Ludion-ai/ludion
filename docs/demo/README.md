# Demo: vitest 5, without and with `ludion sync`

`sync-vitest.cast` is an asciinema recording built only from recorded output (`node docs/demo/make-cast.ts`):

- the question and both answers: the Done 3 B runs (`docs/bench/2026-10-11-done3/`, question `vitest-5-0-0-14-b`), Claude Code (`claude-opus-5-5`) with its default tools in a project with vitest 5.0.3 installed. Without sync the answer was graded wrong; with sync, correct.
- `sync-output.txt` and `grep-output.txt`: `ludion sync` (built from main on 2026-10-12) run in a copy of that project against <https://ludion.ai>.

The `claude -p` lines stand for those runs; the cast replays their answers and doesn't call a model. Play it with `asciinema play docs/demo/sync-vitest.cast`, or upload it to asciinema.org.
