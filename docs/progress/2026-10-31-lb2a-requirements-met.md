# 2026-10-31 — LB2a, sixth round: every requirement met in both views of package-lock.json

PR #215 (branch `lane/lb2a-deliver-checks`), after the lane's review 6525352604 at ebfe89d (REQUEST CHANGES): a moved entry's requirement was never checked as met by the lock, so npm `install` fetched an unpinned, unjudged copy. Detail: docs/bench/2026-10-30-lb-design/README.md, "LB2a, sixth round".

**Changed.** readLock (judge.ts), shared by `ludion judge` and the PR job, does two things:
- It reads the npm 6 tree under a closed list of keys, each one equal to what `packages` says at the same path.
- In both views, it requires every requirement to be found by Node's lookup at a version its semver range takes. This covers each entry's dependencies, optional dependencies and required peers, and the project's and its folders' own requirements.

A lock with an unmet requirement is refused, by the judge too. The same fails closed for a project whose `overrides` force a version out of range, for a lock written with `--legacy-peer-deps` that leaves a peer out, and for a git or URL dependency. (Undone the same day: the requirement check now compares the change with the base and counts `overrides`, so such locks are read again; docs/progress/2026-10-31-lb2a-fix-a.md.)

**Results, in Docker, one container at a time with `--memory`.**
- Tests at 55fbb67: 35 files, 1,219 passed, 19 skipped (docs/bench/2026-10-30-lb-design/logs/test-lb2a-fix6.log).
- Mutations:
  - At 6efb04e: 113 of 114 caught. One was equivalent and was removed with the guards it mutated (docs/bench/2026-10-30-lb-design/logs/mutate-lb2a-fix6-first.log).
  - At 55fbb67: 113 of 113 caught (docs/bench/2026-10-30-lb-design/logs/mutate-lb2a-fix6.log).
- Both jobs at 6efb04e: npm-v2, npm-two and npm opened their PRs on run 1 and none on run 2 (docs/bench/2026-10-30-lb-design/logs/e2e-lb2a-fix6.log).

**Not done.** Running on GitHub (LB2b). A real fix whose new version moves another locked package (such as axios 0.21.2 with follow-redirects) is refused by the PR job, so it cannot be delivered. How many real locks this reading refuses has not been measured.
