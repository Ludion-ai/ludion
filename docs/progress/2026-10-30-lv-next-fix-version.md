# 2026-10-30 (LV) — when the smallest fixed version cannot be used, `patch` takes the next smallest

Started from main fcbff49. When an npm package's smallest fixed version is deprecated, no longer listed by the registry, or named by an OSV record (a MAL- record or an advisory), `ludion patch` now takes the next smallest version of the same major (0.x: the same minor) that is none of these, looking at up to 50 later versions. The fix's receipt entry lists each version passed over and why (`fixes[].version_choice`). Without such a version, or when that lookup fails, the smallest stays and the fix is judged as before. Composer and Maven are out of scope: neither registry has per-version deprecation to read. The gates' numbers and the wait table are unchanged. Detail: docs/bench/2026-10-30-lv-next-fix-version/README.md.

- **Tests** (Docker, image ludion-l9-node24-git): `tsc` 0, the CLI tests 18 files, 767 passed, 19 skipped (`logs/test.log`). CI's checks except Playwright: typecheck 0, build 0, `npm test` 31 files, 1013 passed, 19 skipped (`logs/full.log`). Mutations: 19 of 19 caught (`logs/mutate.log`).
- **The built CLI on the npm example** (`logs/e2e.log`, started 2026-10-30T01:25:07Z, live registry and OSV, `patch --apply` twice on a committed copy of examples/npm-security):

| Fix | Passed over | First run | fix_published_at | applied_at |
|---|---|---|---|---|
| lodash 4.17.20 → 4.18.1 | 4.18.0: "deprecated: Bad release. Please use lodash@4.17.21 instead." | applied, ludion/npm/lodash-4.18.1 (judge `ready_except_build`, urgency high, wait 72h ended 2026-04-04T21:01:20.458Z) | 2026-04-01T21:01:20.458Z | 2026-10-30T01:25:28.248Z |

  The same example's lodash fix stopped at 4.18.0 on 2026-10-30 before this change (docs/progress/2026-10-30-la-git-path.md). The second run skipped the fix, whose branch existed.
- **Not done.** Nothing was released or merged, and nothing was pushed from the example repository.
