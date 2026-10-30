# 2026-10-30 (LA6) — `--apply` starts git by absolute path, never from inside the repository

Main 3b22d2a (#208, `findProgram`) merged into PR #204's branch. The review of 89fd0c8 (comment 6503011718) found that `packages/cli/src/security/branch.ts` started `git` by name, so PATH chose it, and `npx`, `npm exec` and package scripts put the project's `node_modules/.bin` first on PATH (as can a Composer script with `vendor/bin`, or an activated `.venv`). Git is now started by the absolute path `findProgram("git", …)` returns, with the repository (the nearest folder at or above the project with a `.git` entry) as the folder whose insides are skipped. When no such git exists, `--apply` refuses before any Docker work: "--apply needs git, and none was found in PATH's absolute folders (…). Run without --apply to validate only." What changed and how it was checked: docs/bench/2026-10-29-la-per-fix-apply/README.md, "Git by absolute path (LA6)". Record: docs/mistakes/2026-10-29-git-found-in-the-project-folder.md.

- **Tests** (Docker, image ludion-l9-node24-git): `tsc` 0, the CLI tests 18 files, 745 passed, 19 skipped (`logs/test.log`). CI's checks except Playwright: typecheck 0, build 0, `npm test` 31 files, 991 passed, 19 skipped (`logs/full.log`). The site checks with Playwright: e2e 30 passed and 1 skipped, widths 2 passed (`logs/site.log`).
- **The built CLI on the examples** (`logs/e2e-la6.log`, started 2026-10-30T00:18:00Z), `patch --apply` twice on committed copies of examples/*-security, with the real sandbox and git 2.39.5 at /usr/bin/git:

| Case | Fix | First run | fix_published_at | applied_at |
|---|---|---|---|---|
| npm | lodash 4.17.20 → 4.18.0 | failed: "The judge stops the candidate: gate 2: lodash@4.18.0 is deprecated: Bad release. Please use lodash@4.17.21 instead." | 2026-03-31T18:18:42.717Z | null |
| npm, two fixes | lodash 4.17.20 → 4.18.0 | failed (the same judge stop) | 2026-03-31T18:18:42.717Z | null |
| | minimist 1.2.5 → 1.2.6 | applied, ludion/npm/minimist-1.2.6 | 2022-03-22T02:50:30.352Z | 2026-10-30T00:18:49.292Z |
| PHP | the Dockerfile's PHP image → 8.4.27 | applied, ludion/php/8.4.27 | 2026-10-21T00:00:00.000Z | 2026-10-30T00:19:05.206Z |
| Composer | symfony/http-foundation 5.4.0 → 5.4.54 | applied, ludion/composer/symfony-http-foundation-5.4.54 | 2026-09-30T11:07:08.000Z | 2026-10-30T00:19:29.916Z |
| Maven | commons-text 1.9 → 1.10.0 | failed (commons-lang3 3.12.0 still under GHSA-j288-q9x7-2f5v) | null | null |
| | commons-lang3 3.11 → 3.18.0 | applied, ludion/maven/org.apache.commons-commons-lang3-3.18.0 | null | 2026-10-30T00:19:47.467Z |

- **Outcomes.** failed, partial, applied, applied and partial on the first run (patch exit 2, 2, 0, 0, 2), the same as LA5's run (docs/progress/2026-10-30-la-judge-per-fix.md). On the second run every fix with a branch was skipped.
- **Not done.** Nothing was released or merged, and nothing was pushed from the example repositories.
