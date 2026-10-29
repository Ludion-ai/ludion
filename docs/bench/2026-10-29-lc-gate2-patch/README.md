# LC — the judge on `ludion patch`'s npm candidates

docs/status.md, "Missing before complete", item 3, for npm only. `packages/cli/src/security/candidate-judge.ts` runs the judge's `judge()` with the judge's live facts (`gatherFacts`) on the change from the project's package-lock.json to the candidate's. `dependency-patch.ts` calls it in one place, right after the time cap. Composer, Maven and PHP Docker are not judged this way.

## What it checks

What `judge()` checks, unchanged, on every package in the candidate's lockfile diff, the fix and every other version the candidate adds or loads:

- **Gate 2.** Lost provenance, a changed repository or workflow, new install scripts, MAL- records, deprecation, withdrawal, a publisher change and new dependencies. The last two extend the wait. Also the time cap's rules 1 and 2, with T from the fixes OSV reports.
- **Gate 1.** Downgrades and advisories the new version adds.
- **Gate 4.** Each changed entry's registry tarball and sha512. The judge's check that only package.json and package-lock.json change holds by construction here: the module reads only those two files, and the patch writes only them. So it checks nothing on this path.
- **The wait.** CLAUDE.md's wait table from the urgency (KEV, severity, EPSS): 12h to 72h, and at most 144h when a publisher change, a new dependency or a replaced version the registry no longer lists extends it. EPSS comes from FIRST's whole daily list since main 459659c (#206), merged in for LC3; no CVE ID is sent.

Every changed version counts as production, as in `ludion judge`, by the owner's decision (docs/decisions/2026-10-29-every-change-counts-as-production.md). The judgement says so in its first finding, and the judge's own `not_checked` list says it too.

The baseline is built and tested first, as before. The judge runs in the candidate's pass, and `patch` goes on to the candidate's build and tests only on `ready_except_build`. The other verdicts fail the receipt with nothing applied:

- `wait`: the reason gives the time the wait ends, and the findings that extended it.
- `stop`: the reason gives the first five stop findings.
- `undecidable`: the reason gives what could not be decided.

The receipt keeps the whole judgement as `judgement`, including its `not_checked` list. The time cap that `patch` already ran (168h rule 2) still runs first and is kept as `time_cap`.

To avoid writing the judge's input assembly twice, `judge-cli.ts` now exports `packageLockInputs`. Both `ludion judge` and the candidate judge read the lockfile change through it.

## Checks run (all in Docker; scripts/ has the scripts)

- **Typecheck, build and the full vitest suite.** At 2055161, after merging main e43e8f8, which removed production.test.ts. In `ludion-l9-node24-git` (Node 24, with a stand-in git repository, because the site build reads git): typecheck exit 0, build exit 0, 28 test files, 877 passed and 19 skipped (`scripts/full.sh`).
- **New tests.** 22 in packages/cli/test/candidate-judge.test.ts and 6 in dependencies.test.ts ("the judge on npm candidates", and one where the judge throws on a lockfile with two paths that differ only in case). Existing patch tests now give their fixture lockfiles a sha512 integrity, and their fixture registry also answers OSV, KEV and EPSS.
- **Mutations** (`scripts/mutate.sh`, at 2055161). Each of these 13 makes tests fail:
  - the call removed from dependency-patch.ts (8 failed);
  - a `wait` let through (7);
  - only the fix judged (12);
  - the lockfile's `dev` kept (1);
  - lookup errors dropped (2);
  - `undecidable` let through (3);
  - the package.json change, new links or changed entries not passed to the judge (1 each);
  - a wait's extend reasons dropped (3);
  - an exception from the judge swallowed in dependency-patch.ts (1);
  - `extraneous: []` passed to the judge (1);
  - an `undecidable` judgement with no stop finding let through (1).
- **Real run** on a copy of examples/npm-security, validation only (no `--apply`). `scripts/example.sh` ran in `scripts/runner.Dockerfile` (node:24-slim with the Docker CLI, both images pinned by digest) against the local Docker daemon, using the CLI built at commit 2055161. Output: `example-npm-security.json` (the receipt in it is 27,867 bytes as written to disk). The first run, at 5f05058, gave the same plan, verdict, urgency, wait and stop and extend findings; only the first finding's wording differed.
  - The plan picked lodash 4.17.20 → 4.18.0, which fixes 5 advisories.
  - The baseline tests passed.
  - The judge stopped the candidate: `lodash@4.18.0 is deprecated: Bad release. Please use lodash@4.17.21 instead.`, and the publisher changed (jdalton, where 4.17.20 has bnjmnt4n).
  - Urgency high, wait 72h.
  - Outcome `failed`; the candidate's tests did not run, and nothing was applied.
  - Without this change, the patch had no deprecation check on that path.

## LC3 (2026-10-29): after #206, EPSS from the whole list

Main 459659c (#206, EPSS from FIRST's whole daily list) was merged in at d3e5eea, only to resolve the conflict in docs/status.md. The changes are in eec8c06; the checks below ran on it.

- **Fake registries.** candidate-judge.test.ts and dependencies.test.ts answered only api.first.org for EPSS. They now serve the whole list as epss.empiricalsecurity.com does (the fixed URL redirects to the day's file), and api.first.org is not answered at all. Two tests collect every URL and request body and check that none carries a CVE ID; one of them runs the whole `patchDependencies`.
- **New failing tests.** The npm-candidate tests in dependencies.test.ts run with and without `--apply` (`describe.each`), so a refusal honoured only with `--apply` fails five tests. candidate-judge.test.ts has a test for an extraneous lockfile folder the candidate removes, a wait extended because the replaced version is no longer listed, high urgency from an EPSS of 0.1, and the EPSS list failing.
- **Typecheck, build and the full vitest suite** (`scripts/full.sh`, image `ludion-l9-node24-git`, `--network none`): typecheck exit 0, build exit 0, 29 test files, 922 passed and 19 skipped. candidate-judge.test.ts has 26 tests (22 before), dependencies.test.ts 76.
- **Mutations** (`scripts/mutate.sh`, 17 in all): the 13 above and 4 new ones each make tests fail:
  - the refusal honoured only with `--apply` (5 failed);
  - the removed half of the extraneous folders dropped in judge-cli.ts (1);
  - no extension when the replaced version is no longer listed (1);
  - EPSS asked of api.first.org with the CVE IDs (40).
  The counts for the first 13 are now: 15, 11, 13, 1, 3, 4, 1, 1, 1, 5, 1, 2 and 1 failed, in the order listed above. The two changes the review of 829ef97 named (the `--apply` condition and the removed extraneous folders) were not run against the old tests: after the merge, the old fake registries fail every judged test, since they do not serve the EPSS list.
- **Real run**, the same as above with the CLI built at eec8c06 (`example-npm-security.json` is now this run): the same plan, receipt outcome, verdict (stop on the deprecation), extend finding, urgency (high) and wait (72h). The five EPSS scores, now looked up in the downloaded list, are the same as in the run at 2055161 (0.07336, 0.21333, 0.00337, 0.02808, 0.01823), and the receipt is again 27,867 bytes.

**The image `ludion-l9-node24-git`** was built on the owner's PC by L9 on 2026-10-28 at 15:24:53Z (docs/bench/2026-10-29-l9b-workspace-findings/scripts/git.sh uses it too). Its first five layers are those of the `node:24-slim` image created on 2026-10-21 (image ID sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205, Node 24.22.1); `docker history` shows one more layer, `apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*`, which gives git 2.39.5. Its image ID is sha256:d723343f39d343ce281d279c1fe7c493ba2b7a63ea321530444c7c228dc7667d. `scripts/node24-git.Dockerfile` writes that recipe down; L9's own Dockerfile was not kept, and rebuilding from it today gets whatever Debian's git package is then.
