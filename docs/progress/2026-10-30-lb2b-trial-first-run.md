# 2026-10-30 — LB2b: the scheduled workflow ran on GitHub once and opened one PR per fix (ludion-trial)

docs/status.md, "Missing before complete", items 1 and 2, first run on GitHub. Start: main 859d40f (#215 not merged). Detail and raw data: docs/bench/2026-10-30-lb2b-trial. Definitions were committed before the run (definitions.md there).

**What ran.** In Ludion-ai/ludion-trial (private, no secrets, settings as the owner left them): Ludion built from 859d40f in Docker, placed only on that repository's `ludion-action` branch (5f740a5); two copies of action/patch-workflow.yml pinned to it, one for an old PHP image (php/, `php:8.4.26-cli-alpine`) and one for a vulnerable npm version (npm/, lodash 4.17.20), both examples copied unchanged. Nothing released, tagged or published; nothing built went to Ludion-ai/ludion.

**Result of the first run** (workflow_dispatch, 2026-10-30):

| Workflow | Run | Conclusion | Fix | PR |
|---|---|---|---|---|
| ludion-php | 41076179380, created 14:57:00Z | success (patch 15 s, pull-request 18 s) | PHP 8.4.26 → 8.4.27, tests passed on old and new | Ludion-ai/ludion-trial#1, Dockerfile only |
| ludion-npm | 41076186488, created 14:57:02Z | success (patch 32 s, pull-request 15 s) | lodash 4.17.20 → 4.18.1, judge `ready_except_build` in the receipt; the PR job's judge did not refuse (it pushed and opened the PR) | Ludion-ai/ludion-trial#2, package.json and package-lock.json |

This is the first time Ludion's two jobs ran on GitHub's runners and GitHub accepted the push and the PR with the workflow's own token (the LB design had only a local stand-in). The token permissions in the job logs were as the template asks (patch: `Contents: read`, `Metadata: read`; pull-request: `Contents: write`, `Metadata: read`, `PullRequests: write`). Minutes: 4 by the definition (four jobs, each under a minute).

**Not yet known.** Whether the schedule fires on time over a week (from 2026-10-30T18:23Z), whether the second run opens no second PR, CI on the PRs (no CI workflow exists in ludion-trial yet; #1 and #2 have no checks), how a waiting or failed fix looks, the lockfile rebuild count. The account's plan and minutes usage are not readable with the session's token.
