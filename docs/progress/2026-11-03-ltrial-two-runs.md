# LTRIAL: two runs of the whole path on ludion-trial (2026-11-03)

Definitions, committed before the runs: docs/decisions/2026-11-03-ltrial-two-runs.md (80a5ec3). Details and raw data: docs/bench/2026-11-03-ltrial/README.md. The code is Ludion-ai/ludion main `3d143fe2a17bf06d9c03292b3bfe57e1b3178617`, built in Docker and placed only on a branch of the private repository Ludion-ai/ludion-trial. Times are UTC.

## Result

All three lines pass, for that commit and this one sample.

| Line | Result | The numbers |
|---|---|---|
| 1 PR on the first run | **Passes** | Run [41614045680](https://github.com/Ludion-ai/ludion-trial/actions/runs/41614045680), 09:48:44Z–09:50:13Z, success. One new PR: [#8](https://github.com/Ludion-ai/ludion-trial/pull/8), lodash 4.17.20 → 4.18.1, head `d94f806d7c3b9f1644695c5f1fc42cdc692fe8ed` |
| The oldest table in the receipt | **Passes** | `fixes[0].resolution`: T 2026-04-01T21:01:20.458Z, 1 requirement, one answer, role `v`, `assert.problems` empty |
| No second PR on the second run | **Passes** | Run [41614487146](https://github.com/Ludion-ai/ludion-trial/actions/runs/41614487146), 09:52:03Z–09:52:23Z, success. The same 8 PR numbers before and after, one PR on the branch, its head unchanged |

The PR's body does not hold the table: it has no field of `resolution`, and names the receipt by its ID (receipt `14b5d144-e027-4052-893c-b63d0128fdee`, in the run's artifact). This line had no pass mark; the definitions expected no, from reading `pullRequestBody`.

Minutes: 4 (3 + 1). No permission was added, and no setting, secret, PAT or App was used or changed.

## What this does not show

- **The oldest version being chosen.** lodash has no dependencies, so the table held one requirement, V itself, with the role `v`. No answer had the role `oldest`, `reused_base` or `same_release`, and no entry moved or was added beside the fix. So the part of LOLD2's path that picks and checks another package's version did not run in this whole-path run: the resolver's table was written and read, and the PR job's `notOldest` had nothing to compare.
- **The PR job's answer to an existing PR.** Run 2's check job answered `work=false` (`every due fix is fixed by an open Ludion PR (npm:lodash #8)`), so `patch` and `pull-request` were skipped, as the definitions expected. What `deliver open` does when the PR exists was not reached.
- **A schedule, CI on the PR, or a merge.** Both runs were by hand, and PR #8 has 0 check runs. Its `ci` run 41614240851 is `action_required` with no jobs, and was not approved.
- **Another commit, a real project, a rate.** One owned example, two runs. Nothing runs this again: it is a record, not a check that fails.
- **A fix that waits or fails.** The fix passed on the first run; its version is seven months old.

## Other things seen

- The smallest fixed version, 4.18.0, is deprecated, so 4.18.1 was taken (`version_choice`), as on 2026-10-30.
- The judge's finding of a publisher change (`lodash@4.18.1 was published by jdalton, 4.17.20 by bnjmnt4n.`, effect `extend`) is in the receipt and not in the PR's body, as docs/status.md says of gate 2's notice.
- The older open PRs #1 to #6 were each not counted by the check job, in both runs (`npm-ltrial may have changed … since the PR's merge base`), as its rule says, since the new folder came after their merge base.
- No failure, and no attempt beyond the two.
