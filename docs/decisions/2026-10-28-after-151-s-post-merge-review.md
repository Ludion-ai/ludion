## 2026-10-28 — After #151's post-merge review

#151 was merged at f78c931 without a review recorded for that head. A fresh-context review of the full diff afterwards approved it with three non-blocking findings (the verdict is on #151 with `reviewed-sha: f78c931…`). Decided:

- **The judge's targets are the change's own fixing versions.** Before, every changed version of a fixed package's name was a target. So another copy of that name in the same change, published after the fix, skipped rule 1, could move T to its own publish time and could anchor siblings. Now:
  - Each fixed advisory carries the vulnerable version and the version it changed to (`FixedAdvisory.from` and `to`), from the change whose `from` had the advisory and whose `to` does not.
  - Per advisory, package and vulnerable version, only the smallest version it changed to is the change's own fix (`ownFixes`). Only those set T, anchor siblings and date the exposure. Every other version is checked by rule 1 like any other.
  - Urgency counts every fix that matches a change on name, vulnerable version and new version. A dependent that moves off the vulnerable version in production ends a production exposure, so its fix keeps the urgency (round 2 of this PR's review). A copy that was never vulnerable does not match.
  - This covers both forms of the case. One is a copy added at a new path (no `from`). The other is a dependent that moved from the vulnerable root copy to a newer nested copy: the resolution diff gives that copy the vulnerable `from` too, so it is a second fix of the same vulnerable version, and not the smallest (found in round 1 of this PR's review).
  - A fix of another vulnerable version (a second major line, say) keeps its own target.
  - Cost: a dependent that moves off the vulnerable version to a newer copy than the change's smallest fix of it, published after that fix, stops under rule 1. That fails closed.
  - This is what `ludion patch` already did (round 2 of #151): its targets are the plan's own versions.
  - The backtests were not rerun.
- **The same-release exception stays in `ludion patch`, and its residual risk is restated.** The entry "Rule 1's same-release exception" says of an allowed sibling that "the wait and the re-query still apply to it". That is true only in `ludion judge`. `ludion patch` has no wait and no later re-query: an allowed sibling gets only the OSV scan at patch time and the build and test behind it. That is also all the fix itself gets in `ludion patch`, and the exception trusts a sibling as much as the fix, so it is kept there. The earlier entry is left as it was written before backtest v4; this entry corrects it.
- **The publisher-name rule, stated exactly.** Any name outside `[a-z0-9][a-z0-9._-]*` counts as no account, as does `trustedPublisher` or an `npm-oidc-no-reply@` email. "Another CI's shared user then fails closed" holds only when that user has one of those marks. A shared CI account with a plain lowercase name and neither mark still counts as an account. The code comments and test titles now say this, and tests pin `-bot`, `_bot` and `bob!` as no account.

