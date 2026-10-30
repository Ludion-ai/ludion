# 2026-10-30 (LI) — Provenance compared by the repository's immutable id

Started from main 576e601. Detail: docs/bench/2026-10-30-li-provenance-id. The gates' numbers and the wait table are unchanged.

- **Decision first**: docs/decisions/2026-10-30-provenance-immutable-id.md, committed at edce8c2 before the code.
- **npm-facts.ts, time-cap.ts, judge.ts, next-fix.ts**: provenance also carries GitHub's repository id and event (v1's `internalParameters.github`, v0.2's `invocation.environment`). In gate 2, the same-release exception and the next fix's publisher check: ids that differ stop, an id on one side only stops, and neither is compared as before with a note that it was not compared by ID; an event other than push, release or workflow_dispatch, or an id without an event, stops (gate 2: the version installed; the other two: either side). A name that differs with the same id still stops.
- **Documents**: docs/status.md, both READMEs (the next fix's sentence), docs/mistakes/2026-10-30-provenance-compared-by-name-only.md.
- **Checks** (Docker, image ludion-l9-node24-git):
  - CLI tests (logs/test-2.log): tsc exit 0; 21 files passed, 926 passed, 19 skipped.
  - CI's checks except Playwright (logs/full-1.log, on the final files): typecheck 0, build 0, `npm test` 34 files passed, 1172 passed, 19 skipped.
  - Mutations (logs/mutate-1.log): 27 of 27 caught; the baseline passes before and after.
- **Review round 1** (PR comment 6521095566, REQUEST CHANGES on 60305c6). Finding 1 (blocking): npm writes the id and the event from the build's environment variables, which the publishing workflow can set, and the registry is not shown to match them against the certificate; the texts implied more. Fixed in wording: the judge's `not_checked` has a line saying so, and docs/status.md, the decision's "What stays true" and the mistake record say a re-registered name that writes the old id and an allowed event passes, caught only by the wait and the re-query. Findings 2, 3, 4 and 6 fixed (an entry without `by_id` is shown as not compared by ID; each form's values come from its own block; id and event printed through `plain`; a test comment). Finding 5 (no measurement of false stops on real data) is not done.
- **Checks after round 1** (Docker): CLI tests (logs/test-3.log) tsc exit 0, 21 files passed, 928 passed, 19 skipped; CI's checks except Playwright (logs/full-2.log) typecheck 0, build 0, `npm test` 34 files passed, 1174 passed, 19 skipped; mutations (logs/mutate-2.log) 31 of 31 caught.
- **Not done.** No live run against the registry. GitLab's project id is not read. The Sigstore signature and certificate are still not verified. Nothing was released or merged.
