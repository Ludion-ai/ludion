# What Ludion does today

As of 2026-10-29. Update this file in the same PR as the change it describes. Until something is listed under "Built", do not describe the preview, its comments or the updates it judges as gated, waited or "passed the four gates".

Ludion is a judge for npm dependency-update PRs (`ludion judge`, and the GitHub Action in action.yml). It comments on an existing update and changes nothing. The scope was cut to the judge on 2026-10-29 (docs/decisions/2026-10-29-judge-only.md).

## Built

- **Gates 1 and 2 on every changed install path.** Gate 2's checks (provenance lost or from another repository or workflow, new install scripts, OSV MAL- records, deprecation, withdrawal; a publisher change or new dependencies extend the wait) and gate 1's downgrade and advisory checks run on every install path whose package or version changes, and on every package a dependent loads for an existing requirement that it did not load before: shadowing, moved or upgraded dependents, removed copies, aliases. A newly added requirement that lands on an already-installed copy is not compared.
- **Every changed version counts as production.** There is no production/dev split, and the lockfile's `dev` flag is not used, so urgency is never lowered to dev-only and the 7-day dev-only wait is never applied.
- **Rules 1 and 2** on every version a change adds besides the fix itself: it must be in the current lockfile or published before T, the fix's publish time, and a new dependency whose package first appeared less than the urgency's base wait before T stops. The same-release exception lets a version published at or after T past rule 1 only as a target's own release: both have provenance naming the same repository, workflow and commit (each statement must name its version and tarball hash), or neither has provenance and they share the publisher account (trusted publishing's shared user never matches) and the version number, published at most 15 minutes after that target.
- **Gate 4's checks on every changed entry:** the changed files, package.json, each entry's registry tarball and its sha512 integrity. A changed `*/package.json` is left out of the changed-files stop when it agrees with the lockfile (docs/decisions/2026-10-29-l9-workspace-package-json.md); one that does not agree stops, one that cannot be read is undecidable, and a `!` workspaces entry or a top-level `"__proto__"` change stops.
- **The waits of the design's wait table**, not its weekly batching.
- **Exposure evidence:** each judgement records when the fix was published and when the judge saw it.
- **What it asks, and of whom:** package documents and attestations from the npm registry; advisories from OSV, sent package names and versions, then the advisory IDs OSV returned; CISA's catalog of exploited vulnerabilities, downloaded whole; EPSS scores from FIRST, sent the CVE IDs of the advisories the update fixes. No source is sent.
- **Where it runs:** on this repository's own dependency PRs (judge.yml and judge-comment.yml), and as a GitHub Action (a preview, not released).
- **pnpm-lock.yaml** is read as the set of versions it adds; each entry's tarball, hash and what each dependent loads are not checked, so a pnpm judgement is always undecidable.

## Not built

- Gate 1's OS, SAPI and configuration matching.
- Gate 2's inspection for obfuscated code and new network or process calls.
- Gate 3, building and testing old and new, and the check that a changed package loads. So the judge never says "apply".
- The check that a PR holds one fix (gate 4).
- A scheduled re-query when the wait ends: it happens only if the judge is run again then.
- A project's own stricter wait: `judge()` takes one, but no caller passes it.
- Automatic merge.
- Protected paths enforced by GitHub (the agents' own account, CODEOWNERS and a ruleset), a release condition of the preview.

## Evidence

- **Backtests,** up to v5 (docs/bench/2026-10-28-backtest-v5), do not meet the backtest gate: one malicious version is still missed (v5 also counts it as disputed) and unknowns remain.
- **Noise measurements** (docs/bench/2026-10-28-noise-v2, docs/bench/2026-10-29-l1c, and the third sample in PR #196, closed without merging, where its measurements stay) measured the production/dev split, which was removed; none met its count gate or its miss gate.
- **Shadow operation:** the recorder runs (docs/progress/2026-10-29-ls-shadow-recording-start.md), and the replay that judges what it captures is built (tools/shadow, PR #194). The first four-week window ends on 2026-11-26 JST, so automatic merge's condition (b) has no result before 2026-12-10.
