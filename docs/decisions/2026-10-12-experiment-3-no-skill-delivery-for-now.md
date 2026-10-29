### 2026-10-12: Experiment 3: no skill delivery for now

- Rule set in advance: build skill delivery (`.agents/skills/ludion-<subject>/SKILL.md`, loaded only when relevant) if 500 unrelated lessons in `lessons.md` drop B accuracy by 10 points or more.
- Measured (`docs/bench/2026-10-12-exp3/`), one trial per condition: 40/45 with 0 unrelated lessons, 41/45 with 50, 41/45 with 500. No drop was seen, so it isn't built. Runs of the same setup differ by up to 4 of 45, so this rules out a large drop, not a small one.
- Two things to watch: cost (the 45 answers cost $5.76 with 0 and $23.11 with 500, from the longer context), and two answers that went wrong only with unrelated lessons: vitest-5-0-0-16 at both 50 and 500, and vitest-5-0-0-5 at 500, which said it found no changelog entry although its lesson was in the file. If a project's `lessons.md` gets long in practice, cost is the first reason to revisit this, before accuracy.

