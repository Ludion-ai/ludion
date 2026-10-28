### 2026-10-11: Seeds, the plugin, site pages, reverify (PRs open); how Done 3 is measured

- Built:
  - 30 seed lessons (#36), 29 with differential tests that passed in CI's Docker run.
  - The Claude Code plugin (#31).
  - Subject pages, `/start`, `/models`, tombstones and seed labels (#32).
  - The `>` in details, split out on request (#40).
  - Nightly reverify (#37).
  - Per-model FreshBench: Haiku, Sonnet and Opus, no tools, two trials each (`docs/bench/2026-10-11-models/`).
- Checked:
  - Realistic screening without lessons: 14/45 (`docs/bench/2026-10-11-realistic/`).
  - Done 1 shown (above).
  - Value preview: 34/45 with the seed drafts synced, but on the A questions, which the seeds came from. Seeds were rewritten after it, so it is reference only.
  - Fresh-context reviews of #32, #36, #37 and #40. Their findings are being fixed, and the seeds get every fix before their merge is requested.
- Decided ("Measuring Done 3" in `docs/decisions.md`): the official Done 3 freezes the seeds first. It measures on the B questions and on C tasks (coding tasks written from the answer keys alone, graded by rules on the files the agent leaves). A questions are never used again for Done 3. A measurement taken before a seed rewrite is discarded and repeated (replaced the same day: see the entry above).
- A misleading lesson is worse than none: in the preview, one seed's wording turned a right answer into a wrong one.

