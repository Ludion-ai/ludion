# 2026-10-29 (LS) — The shadow's replay is built; there is no (b) result yet

The replay that judges what the shadow's recorder captures: `tools/shadow/src/replay.ts` and `tools/shadow/src/disputed.ts`. It counts condition (b) as docs/decisions/2026-10-29-shadow-counting.md fixes it; that file is unchanged. Details, and the readings taken where the decision is not literal: docs/bench/2026-10-29-shadow-replay/README.md.
- **Tests.**
  - 32 new tests; 67 with the recorder's.
  - All pass in Docker with no network, and typecheck exits 0.
  - 13 deliberate mutations each make tests fail (`logs/check.log`).
- **A preliminary run** on a copy of the recorder's store, taken at 2026-10-29T01:06:35Z. The recorder was not touched.
  - **The window.** 2026-10-28T15:51:48.401Z to 2026-11-25T15:51:48.401Z, in progress, no break.
  - **The versions.** 321 in the window, all pending. Every row's `wait_until` is past the store's coverage, the last daily OSV read at 2026-10-29T00:00:20.329Z.
  - **The gate.** Decided 0 of 100. Misses 0. No MAL- record stored names a watched version.
  - **Capture.** Lag median 0.012h, p90 0.017h. Capture gaps 0.
- **Condition (b).** Not met and not decided: the result is final only after 2026-12-09T15:51:48.401Z (the window's end + 336h), and only if no UTC day passes without a successful poll.
- **Not changed.**
  - CLAUDE.md (a protected path) and the two earlier shadow READMEs still say the replay is not built.
  - `.github/workflows/` is not touched; moving the shadow to GitHub Actions is the SA lane's.
