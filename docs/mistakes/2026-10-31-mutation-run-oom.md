# 2026-10-31 — A mutation run counted test processes killed for memory as caught mutations

- **What happened.** In #215's ninth round, the run of all 138 mutations at 0059cb3 (container with `--memory 4g` and a tmpfs `/tmp`) reported "137 of 138 caught". From mutation 72 on, every test run ended in 1 s instead of about 12 s: the container had reached its memory limit (`docker inspect`: OOMKilled true), so vitest was killed, and mutate.mjs counts any failing run as a caught mutation. The clean runs at the end failed too (five of seven test files), which is how it was seen. The log is kept (docs/bench/2026-10-30-lb-design/logs/mutate-lb2a-fix-g-part1.log); its results do not count.
- **Why.** The tests write their temporary repositories to `/tmp`, and a tmpfs counts against the container's memory limit, so after about 70 runs of deliver.test.ts it was full. mutate.mjs printed the clean runs' failure but still printed "137 of 138 caught" as the result, and a reader of the last line alone would have taken it.
- **Fixed.** The runs since use the container's own disk for `/tmp` (no `--tmpfs`). mutate.mjs now prints "RUN VOID" and exits 1 when any test file fails without mutations.
- **Check:** `docs/bench/2026-10-30-lb-design/scripts/mutate.mjs` — "RUN VOID: a test file fails without mutations".
- **Rule:** "Never fabricate a passing test or weaken one to accept an update."
