## 2026-10-28 (cycle 2) — Dependabot for npm

Added `.github/dependabot.yml`: npm version updates for the root directory, weekly, at most 5 open PRs. Decisions: "Dependabot feeds the judge". In Docker (python:3.14-slim), check-jsonschema 0.33.0's vendored Dependabot schema accepts the file; with `interval: fortnightly` it rejects it. Dependabot reads the file only from the default branch, so its first PRs come after the merge; nothing has run yet.

