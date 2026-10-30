# LV3: OSV's batch answers checked in the judge, and the next smallest fix's publisher check (2026-10-30)

Started from main 8f7e1ec. Two requests in one PR: finding 1 of the cloud review of #212 (https://github.com/Ludion-ai/ludion/pull/212#issuecomment-6514605931), and the owner's decision of 2026-10-30 13:01 JST on finding 3 of the cloud review of #209 (docs/decisions/2026-10-30-next-fix-same-publisher.md, committed before the code). The gates' numbers and the wait table are unchanged.

## What changed

- `osvIds` (npm-facts.ts), which the judge and the next smallest fix use, now checks each batch item as `OsvClient.ids` does (osv.ts): an item that is `null`, a number, a string, a list, an object with a key other than `vulns` and `next_page_token`, or `{vulns: null}` (any `vulns` that is not a list) throws "Invalid OSV batch item; no clean result is available.", and a `next_page_token` that is not a string throws. Before, `(item?.vulns ?? [])` read all of these as "no record". `ludion judge` and the patch's judge (candidate-judge.ts) turn the throw into "A lookup failed", so the judgement is undecidable; `nextFix` throws, so the smallest stays and the judge checks it again.
- `nextFix` (next-fix.ts): when a later version qualifies, it reads both that version and the smallest it passes over from the registry (`registryFacts`, the judge's own read) and compares them (`comparePublishers`): both with provenance naming the same repository and workflow (the commit is not compared), or neither with provenance and the same publisher account (`releaseIdentity` makes trusted publishing's shared user no account). Anything else is a stop: another account, repository or workflow; provenance on one side only; a smallest the registry no longer lists; a statement that does not name its version and tarball; a read that fails. The receipt's `version_choice[].publisher_check` holds the version, both sides as compared, the result (`provenance`, `publisher` or `stop`) and a sentence saying what was compared. On a stop, `chosen` is null.
- `patchDependencies` (dependency-patch.ts): a stop sets the fix's reason ("Gate 2 stops this fix: " and the note, which includes what was compared). The fix keeps the smallest in `changes`, is not validated and gets no branch; other fixes go on. The branch-name check leaves a fix with a reason alone, so the stop stays the reason when a branch of the smallest's name exists.
- README.md, packages/cli/README.md and docs/status.md say this, and correct one sentence: with two changes of one package in a fix, `fix_published_at` and T are the latest publish time among the fix's planned versions (exposure.ts:34, time-cap.ts:70), which can come from the change that was not replaced.
- A behaviour change worth noting: a smallest the registry no longer lists used to give way to the next smallest; now there is nothing to compare, so that fix stops.

## Checks (all in Docker; nothing ran on the host)

`scripts/run.sh <script>` mounts the worktree read-only at /src and copies it into the volume ludion-lv3-w (image ludion-l9-node24-git; `IMAGE` and `DOCKER_ARGS` choose another image and arguments, as for the e2e).

- `scripts/test.sh`: tsc 0; `vitest run --project node packages/cli/test`: 18 files, 807 passed, 19 skipped (`logs/test.log`).
- `scripts/full.sh` (CI's checks except Playwright, against a stand-in repository): typecheck 0, build 0, `npm test` 31 files, 1053 passed, 19 skipped (`logs/full.log`).
- `scripts/mutate.mjs`: 16 of 16 mutations caught (five undo parts of the `osvIds` check, eleven the publisher check and its stop), and the tests pass without them (`logs/mutate.log`).
- `scripts/e2e.sh` (live registry and OSV, image ludion-la-runner, `IMAGE=ludion-la-runner DOCKER_ARGS="-v /var/run/docker.sock:/var/run/docker.sock"`, started 2026-10-30T04:25:07Z): the built CLI's `patch --apply` on a committed copy of examples/npm-security. lodash 4.17.20's smallest fixed version 4.18.0 is deprecated ("Bad release. Please use lodash@4.17.21 instead."); 4.18.1 qualified, and the check found both published by the npm account jdalton, neither with provenance (`result: "publisher"`), so 4.18.1 was taken: judge `ready_except_build`, urgency high, wait 72h, branch `ludion/npm/lodash-4.18.1`, patch exit 0; the second run skipped it (exit 0) (`logs/e2e.log`). The same result as LV's and LV2's runs.

## Tests added

- judge.test.ts: `osvIds` throws on `null`, `7`, `"GHSA-x"`, `{vulnerabilities: []}`, `{vulns: null}`, `{vulns: {}}` and `[]`; reads `{}` as no record; refuses a token and a token that is not a string.
- candidate-judge.test.ts: the patch's judge is undecidable ("A lookup failed: Invalid OSV batch item") for `null`, `7`, `{vulnerabilities: []}` and `{vulns: null}`. `ludion judge` uses the same `gatherFacts` call and the same catch (judge-cli.ts:36), but reads the global `fetch`, so it is not run with a stand-in here.
- dependencies.test.ts: `nextFix` throws on the same four items (the smallest stays). The publisher check goes on for the same repository and workflow from different commits (also with trusted publishing's shared user, since provenance is what is compared) and for the same account; it stops for another account, the shared user without provenance, a missing publisher, another repository, another workflow, provenance on one side (both ways), a failed attestation read, a statement naming another version, a failed second registry read, a record naming no repository or workflow, and a smallest no longer listed. Through `patchDependencies` (with and without `--apply`): another account, a failed read and a smallest no longer listed each stop the fix with no Docker work and no branch, and the stop stays the reason when a branch of the smallest's name exists.

## Not checked

- No real package with provenance on one version and not the next was looked for on the live registry; those cases are covered by stand-ins only.
