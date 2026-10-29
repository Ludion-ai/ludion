# 2026-10-29 (LS) — The shadow's replay is built; there is no (b) result yet

The replay that judges what the shadow's recorder captures: `tools/shadow/src/replay.ts` and `tools/shadow/src/disputed.ts`. It counts condition (b) as docs/decisions/2026-10-29-shadow-counting.md fixes it; that file is unchanged. Details, and the readings taken where the decision is not literal: docs/bench/2026-10-29-shadow-replay/README.md.
- **The reviews.** Three fresh-context reviews on PR #194 (at 80b26f8, 2250791 and b3ed314) asked for changes, and every finding was fixed:
  - MAL- records read as they are today;
  - records whose later copy, or withdrawal, dropped a version from the count or the record-omission rule;
  - versions without a stored publish time, named only by a range, or placed only by the registry;
  - records modified before the recorder started (OSV is now also asked by package name);
  - no predecessor;
  - seeding;
  - "final" that did not wait for OSV reads.
- **Tests.**
  - 48 new tests; 83 with the recorder's.
  - All pass in Docker with no network, and typecheck exits 0, against HEAD's judge and against the start commit's.
  - 30 deliberate mutations each make tests fail (`logs/check.log`, at 658f5c5).
- **A preliminary run** with the network, on a copy of the recorder's store taken at 2026-10-29T01:59:14Z. The recorder was not touched.
  - **The judge.** The start commit's judge files (8a78b55), although main's #193 has since changed judge.ts.
  - **The window.** 2026-10-28T15:51:48.401Z to 2026-11-25T15:51:48.401Z, in progress, no break.
  - **The versions.** 337 in the window, all pending. Every row's `wait_until` is past the store's coverage, the last daily OSV read at 2026-10-29T00:00:20.329Z.
  - **The gate.** Decided 0 of 100. Misses 0.
  - **MAL- records.** 7 records from OSV's answers name 19 watched versions, all published in 2025 and outside the window. None of the 15 records the recorder stored names a watched package.
  - **Capture.** Lag median 0.012h, p90 0.017h. Capture gaps 0.
- **Condition (b).** Not met and not decided. The result can be final only:
  - after 2026-12-09T15:51:48.401Z (the window's end + 336h);
  - with an OSV read at least 24h later;
  - with the network;
  - and with no UTC day passing without a successful poll.
- **Not changed.**
  - CLAUDE.md (a protected path) and the two earlier shadow READMEs still say the replay is not built.
  - `.github/workflows/` is not touched; moving the shadow to GitHub Actions is the SA lane's.
