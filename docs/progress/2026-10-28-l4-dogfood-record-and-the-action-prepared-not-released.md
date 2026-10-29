## 2026-10-28 (cycle 3, L4) — Dogfood record, and the action prepared (not released)

docs/bench/dogfood.
- **Judged.** 3 dependency PRs (#161 stop, #162 stop, #163 ready_except_build) in 5 judge attempts. judge_seconds ranged from 0.629 to 5.637 and job_seconds from 12.742 to 21.72.
- **Step 1 checked.** On #161, re-runs 2 and 3 logged `Updated the judgement comment`: one comment, 6467253162.
- **Not judged.** #164 and #165 had no judge run; the cause is not known.
- **The stops.** #161 stops on gate 4 only, because the PR also touches a workspace's package.json (apps/worker). #162 has the same gate 4 stop (apps/site) and two gate 2 stops: unist-util-visit-parents@6.1.0 and unist-util-visit@5.2.0 were published at or after T.
- **The action.** Checked locally in Docker with gh stubbed (17 of 17), and live in mode judge on throwaway PR #169, which is closed. Mode comment has not run on GitHub.
- **npm pack.** README.md, dist/cli.js and package.json. Nothing was published.

