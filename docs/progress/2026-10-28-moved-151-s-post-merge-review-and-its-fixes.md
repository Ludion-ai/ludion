## 2026-10-28 (cycle 2) — #151's post-merge review, and its fixes

#151 was merged at f78c931, a docs-only commit after the last recorded review (b885de6). A fresh-context subagent reviewed the full diff 2c1c1e7..f78c931 after the merge: **APPROVE**, with three non-blocking findings. The verdict is on the PR (https://github.com/Ludion-ai/ludion/pull/151#issuecomment-6463525016, `reviewed-sha: f78c931ecd4a3bd46eb58483a0f8d52008d862c9`). This PR fixes them (decisions: "After #151's post-merge review"):

- The judge's rule-1 targets are now the change's own fixing versions (`ownFixes`): per advisory, package and vulnerable version, the smallest version it changed to. They used to be every changed copy of a fixed package's name. The exposure date counts the same way. Urgency counts every fix that matches a change on name, vulnerable version and new version, so moving a production dependent off the vulnerable version keeps its urgency (round 2).
- The residual risk for `ludion patch` is stated correctly: it has no wait and no re-query.
- The publisher-name comments and tests now say what the code does.

The PR's own review asked for changes in round 1 (https://github.com/Ludion-ai/ludion/pull/153#issuecomment-6463758266). Its blocking finding: the first version keyed targets by the fixing version only. A dependent that moves from the vulnerable root copy to a newer nested copy gives that copy the vulnerable `from` through the resolution diff, so it stayed a target. Fixed with `ownFixes`; the case is tested through `allChanges` and `gatherFacts` (stubbed fetch). Also from round 1:
- the exposure date uses the same match;
- a delta review is enough only for PRs without protected paths;
- a wrong fact in the #151 file list is removed.

Local run in Docker (node:24-slim; `npm ci` with network, then no network, read-only root, non-root): typecheck passes; packages tests: 210 passed (rounds 1 and 2). The new target and `allChanges` tests fail with the earlier rules (checked on a copy). The site build needs git and was not run in the container; CI runs the full suite. The backtests were not rerun: their updates hold one copy of the fixed package, so the change should not move them, but that is not checked.

