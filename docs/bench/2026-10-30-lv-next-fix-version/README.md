# LV: the next smallest fix when the smallest cannot be used (2026-10-30)

Started from main fcbff49. Before this, `ludion patch` planned each npm package at its smallest fixed version and, when that version was deprecated (lodash 4.18.0, "Bad release"), no longer listed, or had an OSV MAL- record, the judge stopped the fix and the hole stayed open.

## What changed

- `packages/cli/src/security/next-fix.ts` (new): `nextFix(name, smallest)` reads the registry's version list once (`registryVersions` in npm-facts.ts), asks OSV (batch, names and versions only) about the smallest and up to 50 later versions of the same major (0.x: the same minor) that the registry lists and has not deprecated, and returns null when the smallest can be used. Otherwise it returns the versions passed over, smallest first, each with its reason (no longer listed, deprecated with the message made one line of at most 200 characters, in OSV's malicious-package records, or named by another OSV advisory), and the first later version that is none of these, or null when none is.
- `patchDependencies` (npm only), after the run's MAL- check and before the branch names: each fix's planned versions go through `nextFix`. A version taken replaces the change's `to` in that fix (new objects, so `before.plan` keeps the smallest); the fix's receipt entry gets `version_choice`. When none qualifies, the smallest stays and the judge stops it, as before. When the lookup fails, the smallest stays with a note, and the judge checks it again (its own registry and OSV reads), as before.
- `fix_published_note` says when the smallest was passed over: `fix_published_at` is then the version taken's publish time.
- The CLI prints each `version_choice` note and the versions passed over under the fix's line.
- Composer and Maven: out of scope. Packagist's p2 metadata has `abandoned` only for a whole package (in `fzaninotto/faker.json` it appears once, on the newest entry, and the minified format carries it to every version); Maven Central's `maven-metadata.xml` lists versions only. Neither has per-version deprecation or withdrawal to read.
- The gates' numbers and the wait table are unchanged; the version taken goes through the same time cap, judge, re-scan and tests.

## Checks (all in Docker; nothing ran on the host)

`scripts/run.sh <script>` mounts the worktree read-only at /src and copies it into the volume ludion-lv-w (image ludion-l9-node24-git; the e2e uses ludion-la-runner with the Docker socket).

- `scripts/test.sh`: tsc 0; `vitest run --project node packages/cli/test`: 18 files, 767 passed, 19 skipped (`logs/test.log`).
- `scripts/full.sh` (CI's checks except Playwright, against a stand-in repository): typecheck 0, build 0, `npm test` 31 files, 1013 passed, 19 skipped (`logs/full.log`).
- `scripts/mutate.mjs`: 19 of 19 mutations caught, and the tests pass without them (`logs/mutate.log`).
- `scripts/e2e.sh` (live registry and OSV): the built CLI's `patch --apply` on a committed copy of examples/npm-security. lodash 4.17.20's smallest fixed version is 4.18.0, deprecated ("Bad release. Please use lodash@4.17.21 instead."); the fix took 4.18.1, the judge's verdict was `ready_except_build`, the baseline and candidate tests passed, and the branch `ludion/npm/lodash-4.18.1` was made; the second run skipped it (`logs/e2e.log`). The same example stopped at 4.18.0 in docs/bench/2026-10-29-la-per-fix-apply/logs/e2e-la6.log.
