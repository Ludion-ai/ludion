# 2026-10-30 (LI) — Provenance compared by the repository's immutable id

Started from main 576e601. Detail: docs/bench/2026-10-30-li-provenance-id. The gates' numbers and the wait table are unchanged.

- **Decision first**: docs/decisions/2026-10-30-provenance-immutable-id.md, committed at edce8c2 before the code.
- **npm-facts.ts, time-cap.ts, judge.ts, next-fix.ts**: provenance also carries GitHub's repository id and event (v1's `internalParameters.github`, v0.2's `invocation.environment`). In gate 2, the same-release exception and the next fix's publisher check: ids that differ stop, an id on one side only stops, and neither is compared as before with a note that it was not compared by ID; an event other than push, release or workflow_dispatch, or an id without an event, stops (gate 2: the version installed; the other two: either side). A name that differs with the same id still stops.
- **Documents**: docs/status.md, both READMEs (the next fix's sentence), docs/mistakes/2026-10-30-provenance-compared-by-name-only.md.
- **Checks** (Docker, image ludion-l9-node24-git):
  - CLI tests (logs/test-2.log): tsc exit 0; 21 files passed, 926 passed, 19 skipped.
  - CI's checks except Playwright (logs/full-1.log, on the final files): typecheck 0, build 0, `npm test` 34 files passed, 1172 passed, 19 skipped.
  - Mutations (logs/mutate-1.log): 27 of 27 caught; the baseline passes before and after.
- **Not done.** No live run against the registry. GitLab's project id is not read. The Sigstore signature and certificate are still not verified. Nothing was released or merged.
