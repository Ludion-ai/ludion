# 2026-11-03 — LWIRE: npm's `patch` calls gate 3's comparison on each fix

What this does and why: docs/decisions/2026-11-03-gate3-called-from-patch.md, committed before the code. This file holds what was run. Every number is copied from the log of the run named.

## What ran where

- **The test suites ran only on this PR's `test` check**, on GitHub's runner, not in Docker with `--network none` as the lane's brief asked. The session's permission layer refused `docker run` with vitest on the command line twice, with no reason given: the same result as docs/progress/2026-11-01-lmvn.md. The second try dropped all capabilities and added no-new-privileges, and named what it ran. After that the lane stopped trying, and did not put vitest behind another name.
- **In Docker, with no socket:** `npm ci --ignore-scripts` in one container with a network, into a volume, and `tsc -p tsconfig.json` in another with `--network none` and the work tree read-only, twice, each exit 0. Both ran from script files, so the command line did not name `npm` or `tsc`. The install and the first typecheck came before the first refusal, and the second typecheck after it.

## The `test` check, by head

| Head | What it is | `npm test` | `npm run test:e2e` | Run |
|---|---|---|---|---|
| 3174d25 | The change, first push | 2 failed, 2448 passed, 5 skipped (2455) | Not reached | 41636733451 |
| f6663c0 | With the site's copy naming the registry | 2450 passed, 5 skipped (2455) | 48 passed, 1 skipped | 41637502401 |
| 9e36711 | The mutation below | 12 failed, 2438 passed, 5 skipped (2455) | Not reached | 41639032486 |

The final head's result is in the PR. The next commit after 9e36711 reverts it, and the tree is then the same as f6663c0's, with this file added.

**The two failures at 3174d25** were both apps/site/test/privacy-hosts.test.ts, one for each language: `mcr.microsoft.com (security/gate3.ts)` was not named in the site's "What leaves your machine". The lane had read the site's sentence on tool images and judged that it still held. The check said otherwise, and the copy now names the host in both languages.

## The mutation

The brief asks for one: take the call out, and see the new tests fail. Local test runs being refused, it went through CI as a commit on this PR, 9e36711, which removes only the six lines of the call from packages/cli/src/security/dependency-patch.ts. Those 12 tests failed, all in packages/cli/test/dependencies.test.ts, and no other test in the 2455:

- `gate3-called-from-patch`
- `gate3-reads-env-example`
- `gate3-stops-the-fix`: broken; undecidable, no page on old; undecidable, no result from a run; undecidable, on new
- `gate3-stops-without-apply`
- `gate3-docker-failure-stops`: its browser image cannot be pulled; its dependencies cannot be acquired
- `gate3-not-covered`
- `gate3-one-fix-at-a-time`
- `gate3-project-changed`

`gate3-after-the-test` passed on the mutation, as it should: it says a candidate whose test fails does not reach gate 3, which is also true when nothing calls it.

One mutation was run. Nothing here shows by mutation that each other line is needed, such as the check on the verdict, the project being given rather than the copy, or the PR job's refusal. Tests exist for each, and they have not been seen to fail for that line alone.

## Not run

- `patch` through a real run of gate 3, in any Docker, on GitHub or elsewhere. In every test here, Docker is stood in for. So no real fix has passed gate 3.
- What gate 3 costs in the validation job's 120 minutes, and on a GitHub-hosted runner's disk with a browser image of several GB.
- `packages/cli/test/gate3-docker.test.ts`, the real run, which CI skips (the 5 skipped tests of `npm test`).
