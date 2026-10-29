# 2026-10-29 (LS) — The shadow's replay is built; there is no (b) result yet

The replay that judges what the shadow's recorder captures: `tools/shadow/src/replay.ts` and `tools/shadow/src/disputed.ts`. It counts condition (b) as docs/decisions/2026-10-29-shadow-counting.md fixes it; that file is unchanged. Details, and the readings taken where the decision is not literal: docs/bench/2026-10-29-shadow-replay/README.md.
- **The reviews.** Two fresh-context reviews on PR #194 (at 80b26f8, then at 2250791) asked for changes, and every finding was fixed:
  - MAL- records read as they are today;
  - records whose later copy, or withdrawal, dropped a version from the count or from the record-omission rule;
  - versions without a stored publish time, or named only by a range;
  - no predecessor;
  - "final" that did not wait for OSV reads.
- **Tests.**
  - 43 new tests; 78 with the recorder's.
  - All pass in Docker with no network, and typecheck exits 0.
  - 25 deliberate mutations each make tests fail (`logs/check.log`, at bebebbe).
- **A preliminary run** on a copy of the recorder's store, taken at 2026-10-29T01:40:34Z. The recorder was not touched.
  - **The judge.** main's #193 changed judge.ts after the recorder started. The run used the start commit's judge files (8a78b55), as the decision requires.
  - **The window.** 2026-10-28T15:51:48.401Z to 2026-11-25T15:51:48.401Z, in progress, no break.
  - **The versions.** 336 in the window, all pending. Every row's `wait_until` is past the store's coverage, the last daily OSV read at 2026-10-29T00:00:20.329Z.
  - **The gate.** Decided 0 of 100. Misses 0. None of the 15 stored MAL- records names a watched package.
  - **Capture.** Lag median 0.012h, p90 0.017h. Capture gaps 0.
- **Condition (b).** Not met and not decided. The result can be final only after 2026-12-09T15:51:48.401Z (the window's end + 336h), with an OSV read at least 24h later. It also needs no UTC day to pass without a successful poll.
- **Not changed.**
  - CLAUDE.md (a protected path) and the two earlier shadow READMEs still say the replay is not built.
  - `.github/workflows/` is not touched; moving the shadow to GitHub Actions is the SA lane's.
