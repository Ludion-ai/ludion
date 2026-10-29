# 2026-10-29 (LC) — `ludion patch` runs the judge on npm candidates

docs/status.md's "Missing before complete" item 3, npm only. `ludion patch` and `watch` now run the judge's parts of gates 1, 2 and 4 and its wait over every package in an npm candidate's lockfile diff, after the time cap and before the candidate's tests. A candidate the judge stops, cannot decide on, or must still wait for is not applied. Composer, Maven and PHP Docker are not judged this way. Every changed version counts as production, as in `ludion judge`, by the owner's decision (docs/decisions/2026-10-29-every-change-counts-as-production.md).

- **Checks.** In Docker, at 2055161 (after merging main e43e8f8): typecheck and build pass; vitest 28 files, 877 passed, 19 skipped; 13 mutations each fail tests.
- **Real run.** Validation only, on a copy of examples/npm-security, with the CLI built at 2055161. The plan picked lodash 4.18.0, which the registry marks deprecated ("Bad release"). The judge stopped it, and nothing was applied.

Details: docs/bench/2026-10-29-lc-gate2-patch/README.md.
