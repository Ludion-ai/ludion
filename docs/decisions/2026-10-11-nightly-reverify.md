### 2026-10-11: Nightly reverify

- **`reverify.yml`** runs at 04:23 UTC every night and by hand. It has two jobs, so lesson code never runs next to a write token:
  - `check` (`contents: read`, no secrets, checkout without credentials) runs `npm run verify -- lessons/ --run --evidence-only` on main.
  - `report` (`contents: write` for branches, `issues: write`, `actions: write`) reads those results and runs only main's own `tools/verify/src/reverify-cli.ts`.
- **Evidence only, active lessons only**: format rules, paths and `replaces` were checked when a lesson merged, and a later rule change must not withhold lessons that still hold. A file today's schema can't read is skipped, not failed. Replaced lessons aren't served, so they aren't checked. Images are pulled before the timed runs.
- **What counts as failing**: a test that ran and failed counts at once. A failure that could be an outage counts only if the same lesson also failed the night before: every reason is a source check, a failed install, Docker not starting, exit 125, or a timeout. "The night before" is the newest completed run of this workflow on main from `schedule` or `workflow_dispatch`, at least 12 hours older. A pull request's run of an edited workflow never counts.
- **Too many at once means the check broke**: when more than 3 lessons and more than a fifth of all fail in one night, tonight changes nothing: last night's list stands (lessons already confirmed failing stay withheld, no new ones are), nothing new is reported, and the run fails so a person looks.
- **Failing lessons leave the index at once**: `report` uploads `failing.json` (lesson ids and when). It starts `deploy.yml` with its run id when the list differs from the newest list (the one production uses), and every night while the list isn't empty, so a failed deploy is retried.
  - `deploy.yml` accepts that run only if the runs API says it is a `schedule` or `workflow_dispatch` run of `.github/workflows/reverify.yml` on main from this repository, and fails if its list can't be downloaded. Without a run id, it uses the newest such run that has a list; with none, nothing is withheld (with a warning).
  - `buildIndex` takes failing lessons out after computing the active set, so a failing correction never brings back the lesson it corrected. They leave `index.json`, the shards, search, and the lists.
  - Their pages stay, with a banner: the lesson failed its nightly check, and Ludion stopped serving it until it passes its check again or is retracted. Main stays the truth: the lesson is only withheld.
- **Retractions are prepared, and a person opens them**: GitHub Actions can't open pull requests in this repository. Turning that on would also let workflows approve PRs, so it stays off.
  - For each failing lesson still on main, `report` pushes `retract/<id>` (deleting the file) and opens an issue labeled `retract`. The issue fences what failed as text, because it comes from lesson output, and links the one-click compare page to open the PR. A PR a person opens runs CI, which a PR opened by Actions wouldn't.
  - An issue that exists for the lesson, open or closed, isn't opened again: closing it is a person's decision. Ids and paths read back from the artifact are checked, and `git rm` gets `--`.
  - Upload and deploy come first, so a reporting error never stops withholding.
- **Accepted limits**:
  - If the example lesson (distutils) ever fails, deploys fail at the Worker tests and `check-production.ts` until it passes its check again or is retracted, and production keeps serving the last index. The fact is a removal from a released Python, so this is unlikely, and the failure is loud.
  - A deploy started by a push uses the newest reverify run that has a list, including one still going (its list is uploaded before it dispatches). Reverify also deploys every night while the list isn't empty, so a missed or failed deploy is caught up within a day.

