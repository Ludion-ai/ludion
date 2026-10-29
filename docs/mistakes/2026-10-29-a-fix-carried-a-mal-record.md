# 2026-10-29 — Per-fix validation let a candidate add a version under an OSV MAL- record

- **What happened.** To let Maven fixes pass on their own, PR #204 compared a candidate's OSV findings with the baseline's by package and advisory, not by version. That applied to every ecosystem. The cloud review of 19b7376 (comment 6496845752) showed the effect. The baseline had `evil@1.0.0` under `MAL-2026-0001`. An npm candidate for lodash added a second copy, `evil@1.0.1`, under the same record. It passed, appeared only as `carried_findings`, and its branch was committed. Also, a MAL- record on a package with no fix no longer stopped the run, as it did on main; the other fixes went on. Nothing was merged.
- **Why.**
  - The looser comparison was written for one Maven case (commons-text bringing commons-lang3 3.12.0) and applied everywhere, without asking what else it would let through.
  - Gate 2's stop on a MAL- record was not re-read when the run's stop on `scan.blocked` became per fix.
- **Check:** `packages/cli/test/dependencies.test.ts` — "stops on an OSV MAL- record: in the baseline before any Docker work, in a candidate for that fix", and "stops a fix whose npm candidate adds a vulnerable version, even under an advisory the baseline had". docs/bench/2026-10-29-la-per-fix-apply/scripts/mutate.mjs mutates each of these and confirms the tests fail.
- **Rule:** "Stop on lost provenance or a changed repository/workflow, new install scripts, an OSV MAL- record, deprecation or withdrawal."
