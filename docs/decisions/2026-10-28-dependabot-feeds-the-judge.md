## 2026-10-28 (cycle 2) — Dependabot feeds the judge

The owner chose C1. With it, `.github/dependabot.yml` gives the judge on this repository (judge.yml, from the designer's C-1) real dependency PRs. There was no Dependabot configuration before. It covers npm version updates, checked weekly, with at most 5 open PRs at a time.

Chosen here:

- **`directory: /` only.** That is the root lockfile, the one judge.yml judges; the workspaces are locked in it. `examples/npm-security` is a fixture and is left alone.
- **Everything else is Dependabot's default**: the day of the week, one PR per dependency (no groups), the default cooldown for version updates (3 days since 2026-07-14; design, "既存ツールとの差"), and the default versioning strategy and labels.
- **The limit of 5 is on version updates.** Security updates are a repository setting, and the limit does not count them.
- **The file only lets Dependabot open PRs.** Nothing in it merges one.

