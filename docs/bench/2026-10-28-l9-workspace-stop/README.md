# L9: the judge's gate 4 stop on workspace package.json changes

Task: a Dependabot update of a workspace's dependency (apps/worker, apps/site, ...) changes that workspace's `package.json`. The judge v0 allows only the root `package.json` and the lockfile, so gate 4 stops it (#161, #162; docs/decisions.md, "Known limits" of the judge on this repository). Such a change should not be a gate 4 stop reason when it agrees with the lockfile change; a change that does not agree still stops.

## Files declared before starting (2026-10-28T12:51:17Z)

L1's files are in `l1-files.txt` (`git fetch origin`, then `git diff --name-only origin/main...origin/lane/l1-applicability`; L1 is #168, at 1a532c0).

L9 changes:

- `docs/bench/2026-10-28-l9-workspace-stop/` (this folder);
- `docs/decisions.md` and `docs/progress.md`, appended at the end only (every lane appends there; L1 also changes decisions.md);
- `packages/cli/src/security/workspace-manifests.ts` (new): whether a workspace's `package.json` change agrees with the lockfile;
- `packages/cli/test/workspace-manifests.test.ts` (new): its tests.

The fix also needs two files that L1 changes. **L9 does not change them** (task: stop and report, the coordinator settles it with L1):

- `packages/cli/src/security/judge.ts`: gate 4's file check (`judge()`, the `unexpected` files, lines 379–385 at 75622bd) is where the stop is made. L1 changes the lines next to it (the `extraneous` stop, the `split` info line) and the `judge()` input type.
- `packages/cli/src/security/judge-cli.ts`: it reads the root manifests and lockfiles and calls `judge()`; it would also read each changed workspace `package.json`. L1 rewrites the same lines (the production/dev split).

Until those two are wired, the new module is not called by `ludion judge`, so #161 and #162 cannot be judged again with a fixed judge (task step 4).
