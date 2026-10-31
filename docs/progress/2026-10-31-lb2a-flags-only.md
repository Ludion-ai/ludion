# 2026-10-31 — LB2a, ninth round: an unplanned npm lock entry may differ in its flags only (B1); bundled and B1 fixtures

PR #215 (branch `lane/lb2a-deliver-checks`), after the R lane's review 6538813186 at e9559e4 (REQUEST CHANGES), on the brain's answer (ludion-ops#1, 6539200199, item 1: option (a)). Decision committed and pushed before the code: docs/decisions/2026-10-31-lock-flags-only.md (97f9cfc). Detail: the design README's "LB2a, ninth round" and docs/bench/2026-10-31-lb2a-npm-corpus/README.md.

**Changed.**
- B1: deliver.ts's `sameButFlags`: an entry the fix neither moves nor adds may differ from the base in `dev`, `optional`, `devOptional` and `peer` only, each `true` or absent; `npmAgain` skips such an entry. The PR text Ludion writes, both READMEs, docs/status.md (its list of what is not built included) and the design README say so.
- N1, N2: fixtures in packages/cli/test/fixtures/npm-corpus/extra/ (12 inbundle locks, B1's node-fetch pair at lockfileVersion 2 and 3), with tests in npm-corpus.test.ts and deliver.test.ts; the Docker test runs npm 12.2.1 again on them too.
- N3: judge.ts's limitation. N4: wording in docs/status.md, docs/mistakes/2026-10-30-deliver-checks-read-past-git.md and the PR body.
- mutate.mjs: mutations 134 to 138 for the rule; 27 and 34 follow lines this round and main's LNODE changed; `MUTATE_FROM`, `MUTATE_ONLY`; "RUN VOID" when a test file fails without mutations.
- main 988bec0 (LNODE, #231) merged in for conflicts in six files (1d28399).
- Records: docs/mistakes/2026-10-31-pr-job-refused-npm-flags.md, docs/mistakes/2026-10-31-mutation-run-oom.md.

**Results.**
- Fixture generation (Docker, `--memory 2g --cap-drop ALL --user node`): all 12 inbundle locks exit 0 with 215 `inBundle` entries each; npm 12.2.1 first stopped with EALLOWREMOTE (its default allow-remote is none; docs/bench/2026-10-31-lb2a-npm-corpus/logs/gen-extra-npm12-eallowremote.log) and wrote them with `--allow-remote=all`. Both node-fetch pairs exit 0; npm dropped `dev` from whatwg-url, tr46 and webidl-conversions only. `npm ls` (npm 12.2.1 and 11.19.1, `--network none`) on all 16 locks: exit 0, no problem.
- Gates of the decision: B1 met (both pairs: `contentProblem` null, `lockEntryChanges` only node-fetch@2.6.7, no new problem from npm, `newUnmetRequirements` empty; the PR job opens the fix and asks the registry only for node-fetch@2.6.7; the five forged changes to tr46 are refused). N1 met (12 of 12 read by main's reader and #215's, 216 entries each, nothing unmet).
- Tests:
  - in Docker at 0059cb3 (`--memory 4g`, `npm ci` then `--network none`, `--maxWorkers=2`; docs/bench/2026-10-30-lb-design/logs/test-lb2a-fix-g.log): typecheck 0, build 0, 38 files, 1,259 passed, 25 skipped;
  - in Docker after main 988bec0 was merged in, before that merge was committed (48 files differing from ddef04c, all of them the merge's; docs/bench/2026-10-30-lb-design/logs/test-lb2a-fix-g-merged.log): typecheck 0, build 0, 39 files, 1,322 passed, 25 skipped (the Docker test is one: no Docker inside the container);
  - in CI at 1d28399: all six checks pass; test: 40 files, 1,353 passed, the Docker test included (npm-corpus.test.ts, 10 tests, 173 s).
- Mutations:
  - at 0059cb3 (docs/bench/2026-10-30-lb-design/logs/mutate-lb2a-fix-g-part1.log): **void**. The container was OOM-killed (a tmpfs `/tmp` under `--memory 4g`); from 72 on every run ended in 1 s, and five test files failed without mutations. Its 137 rows in mutate-results.tsv (head 0059cb3) do not count (docs/mistakes/2026-10-31-mutation-run-oom.md). A second run at ddef04c was stopped after mutation 1 to merge main.
  - at 1d28399, `/tmp` on disk (docs/bench/2026-10-30-lb-design/logs/mutate-lb2a-fix-g.log): 137 of 138 caught, one (24, ReDoS) by the 300 s limit, none survived; 34 not applied (main's LNODE replaced its line with `isImage`). Without mutations, all seven test files pass. The one file differing from 1d28399 was docs/bench/2026-10-30-lb-design/logs/test-lb2a-fix-g-merged.log, an ignored log copied in before the run.
  - 34, pointed at the new line, at 01ad089 with no file differing (docs/bench/2026-10-30-lb-design/logs/mutate-lb2a-fix-g-34.log): caught; deliver.test.ts passes without it. `git diff 1d28399 01ad089 -- packages/ action/` is empty.
  - So **138 of 138 caught** on this round's code.
- N5 (the eighth round's first container): which file differed from 2b496a1 is not recorded, and is not known now.

**Not done.** LFLAGS (flags computed from the lock's graph) is the next lane, not this one. e2e was not run in this round. npm 12.2.1's default allow-remote of none may also stop a candidate that moves a package with bundled dependencies (`patch` passes `--allow-remote=none`); not tested here.
