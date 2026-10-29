# LC — the judge on `ludion patch`'s npm candidates

docs/status.md, "Missing before complete", item 3, for npm only. `packages/cli/src/security/candidate-judge.ts` runs the judge's `judge()` with the judge's live facts (`gatherFacts`) on the change from the project's package-lock.json to the candidate's. `dependency-patch.ts` calls it in one place, right after the time cap. Composer, Maven and PHP Docker are not judged this way.

## What it checks

What `judge()` checks, unchanged, on every package in the candidate's lockfile diff, the fix and every other version the candidate adds or loads:

- **Gate 2.** Lost provenance, a changed repository or workflow, new install scripts, MAL- records, deprecation, withdrawal, a publisher change and new dependencies. The last two extend the wait. Also the time cap's rules 1 and 2, with T from the fixes OSV reports.
- **Gate 1.** Downgrades and advisories the new version adds.
- **Gate 4.** Each changed entry's registry tarball and sha512. The judge's check that only package.json and package-lock.json change holds by construction here: the module reads only those two files, and the patch writes only them. So it checks nothing on this path.
- **The wait.** The design's wait table from the urgency (KEV, severity, EPSS), with the extensions. Not the dev-only 7-day wait, and not its weekly batching: with no split, nothing is dev-only, so the urgency is never `low`. A candidate that moves only dev-only packages waits 12h to 72h instead.

There is no production/dev split: every changed version counts as production (docs/status.md, "Waiting for the owner", 2). The judgement says so in its first finding.

The baseline is built and tested first, as before. The judge runs in the candidate's pass, and `patch` goes on to the candidate's build and tests only on `ready_except_build`. The other verdicts fail the receipt with nothing applied:

- `wait`: the reason gives the time the wait ends, and the findings that extended it.
- `stop`: the reason gives the first five stop findings.
- `undecidable`: the reason gives what could not be decided.

The receipt keeps the whole judgement as `judgement`, including its `not_checked` list. The time cap that `patch` already ran (168h rule 2) still runs first and is kept as `time_cap`.

To avoid writing the judge's input assembly twice, `judge-cli.ts` now exports `packageLockInputs`. Both `ludion judge` and the candidate judge read the lockfile change through it.

## Checks run (all in Docker; scripts/ has the scripts)

- **Typecheck, build and the full vitest suite.** In `ludion-l9-node24-git` (Node 24, with a stand-in git repository, because the site build reads git): typecheck exit 0, build exit 0, 28 test files, 917 passed and 19 skipped (`scripts/full.sh`).
- **New tests.** 20 in packages/cli/test/candidate-judge.test.ts and 5 in dependencies.test.ts ("the judge on npm candidates"). Existing patch tests now give their fixture lockfiles a sha512 integrity, and their fixture registry also answers OSV, KEV and EPSS.
- **Mutations** (`scripts/mutate.sh`). Each of these 10 makes tests fail:
  - the call removed from dependency-patch.ts (7 failed);
  - a `wait` let through (7);
  - only the fix judged (12);
  - the lockfile's `dev` kept (1);
  - lookup errors dropped (2);
  - `undecidable` let through (2);
  - the package.json change, new links or changed entries not passed to the judge (1 each);
  - a wait's extend reasons dropped (3).
- **Real run** on a copy of examples/npm-security, validation only (no `--apply`). `scripts/example.sh` ran in `scripts/runner.Dockerfile` (node:24-slim with the Docker CLI) against the local Docker daemon, using the CLI built from this branch. Output: `example-npm-security.json`.
  - The plan picked lodash 4.17.20 → 4.18.0, which fixes 5 advisories.
  - The baseline tests passed.
  - The judge stopped the candidate: `lodash@4.18.0 is deprecated: Bad release. Please use lodash@4.17.21 instead.`, and the publisher changed (jdalton, where 4.17.20 has bnjmnt4n).
  - Urgency high, wait 72h.
  - Outcome `failed`; the candidate's tests did not run, and nothing was applied.
  - Without this change, the patch had no deprecation check on that path.
