# 2026-10-31 — LB2a, eighth round: the lock reader against a corpus npm 7 to 12 wrote

PR #215 (branch `lane/lb2a-deliver-checks`), after the R lane's review 6533374683 at 6ee07f4 (REQUEST CHANGES), on the brain's option (d): check the reader against locks npm itself writes, and npm's own report on them. Decisions committed before their part of the corpus: docs/decisions/2026-10-31-lock-corpus-against-npm.md (50a531c), docs/decisions/2026-10-31-lock-corpus-npm12.md (e97202b) and docs/decisions/2026-10-31-lock-corpus-alias.md (9daa1eb). Detail: docs/bench/2026-10-31-lb2a-npm-corpus/README.md and the design README's "LB2a, eighth round".

**Changed.**
- The corpus: 72 locks npm 7.10.0, 8.19.4, 9.8.1, 10.8.2, 11.19.1 and 12.2.1 wrote at lockfileVersion 2 and 3 (seven shapes, aliases under another package's name included; bundled never written), 320 one-change variants, npm 12.2.1's and npm 11.19.1's `npm ls --package-lock-only` on each, as fixtures. packages/cli/test/npm-corpus.test.ts reads them, and a Docker test runs npm 12.2.1 again (in CI on every push).
- The identity rule, written down and tested: the package at a location must be the one its spec names, at the top and nested, in both views.
- B1: the npm 6 tree's `devOptional` and `peer` are read; the views compare requirements by name.
- B2: where an override applies, the copy is checked against its spec only.
- N1: `peerDependenciesMeta` is compared with the registry.
- N3: the design README's flag facts. N4: tests for M18 and M22.
- mutate.mjs writes each result to a host file as it finishes, and a run again at the same commit skips what is recorded.
- Record: docs/mistakes/2026-10-31-lock-reader-without-npm-corpus.md.

**Results.**
- G1 met (392 of 392 read where main reads them); G3 met (72 of 72); A1 and A2 met (12 alias locks read by main and #215, nothing unmet).
- G2 met on every variant but V3 (248 of 248). V3 (another package at a location a range requires) is refused by the identity rule, all 72; `npm ls` reports nothing new for 68 of them, since it does not look at which package a location holds. npm 11.19.1 says the same as npm 12.2.1 of all 320 variants.
- Tests:
  - in CI at d17abec and at 3cb03e7 (the code and tests of this round): 39 files, 1,286 passed, the Docker test included (npm-corpus.test.ts, 8 tests, 137 s and 165 s);
  - in Docker at c8f8399, before npm 12.2.1 and the alias shape (`--memory 4g`, `npm ci` then `--network none`, `--maxWorkers=2`; docs/bench/2026-10-30-lb-design/logs/test-lb2a-fix-d.log): 36 files, 1,235 passed, 19 skipped;
  - in Docker at 3cb03e7 (docs/bench/2026-10-30-lb-design/logs/test-lb2a-fix-e.log): typecheck 0, build 0, 36 files, 1,239 passed, 20 skipped (the Docker test is one: no Docker inside the container);
- Mutations:
  - at 5ee8879, before the alias shape and the identity tests (docs/bench/2026-10-30-lb-design/logs/mutate-lb2a-fix-d.log): 131 of 131 caught, one by the 300 s limit;
  - at 2b496a1 (133 mutations; docs/bench/2026-10-30-lb-design/logs/mutate-results.tsv, one line per mutation): **133 of 133 caught**, one (24, the ReDoS pattern) by the 300 s limit; none survived and none failed to apply. Mutations 1 to 23 ran in the first container (docs/bench/2026-10-30-lb-design/logs/mutate-lb2a-fix-e-part1.log), which the machine's Docker engine stopped at about 01:01 UTC; 24 to 133 ran in a second one after Docker was started again, which skipped the 23 it found recorded (docs/bench/2026-10-30-lb-design/logs/mutate-lb2a-fix-e.log). The second ran in the 3cb03e7 tree, whose packages/, action/ and mutation scripts are the same as 2b496a1's (`git diff 2b496a1 3cb03e7 -- packages/ action/ docs/bench/2026-10-30-lb-design/scripts/` is empty). Without mutations, the seven test files pass.
- An earlier run at 7994a5d stopped after 23 of 131 (all caught) when its container was gone; it is not counted.

**Not done.** Bundled entries are not in the corpus (no npm version wrote them from manifests). e2e was not run in this round. A moved or added entry's `hasShrinkwrap`, flags, `bin`, `hasInstallScript` and `engines` are still not compared (docs/status.md).
