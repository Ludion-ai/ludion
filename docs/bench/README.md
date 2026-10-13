# FreshBench

FreshBench measures whether a coding assistant knows what changed in the versions a project installed. Each run's questions, answers, grades, and raw logs are in a dated folder here. The site shows the results at [ludion.ai/bench](https://ludion.ai/bench/), read from these files at build time; this file is also its method page.

## How the questions are made

- **Changes** come from the changelogs and release notes of three packages: wrangler, vitest, and the Cloudflare Agents SDK (`agents`). Each change was picked as something a developer would notice (removed, added, changed, deprecated, or a behavior people get wrong); refactors, docs-only items, and dependency bumps were skipped. Why these packages, and the window the changes come from: [`2026-10-08/README.md`](https://github.com/Ludion-ai/ludion/blob/main/docs/bench/2026-10-08/README.md).
- Each change has its version, its date, a URL at a release tag, an exact quote from that page that passes the same source check lessons use (`checkSource` in `packages/core`), the current fact, and the stale answer.
- **Two questions per change, one answer key.** An **A** question asks it one way; a **B** question asks the same fact differently, and both are graded against the same key. The seed lessons were drafted from those keys, so the B questions differ from what the seeds saw only in their wording. Results that judge the lessons are measured on the B questions.
- **Answer keys are checked against primary sources** (source code at a release tag, or the vendor's docs), not changelog headlines: [`2026-10-11-keys/`](https://github.com/Ludion-ai/ludion/tree/main/docs/bench/2026-10-11-keys). That check found keys from the first run that were wrong or incomplete; they were corrected before any later run, and the first run was graded again ([`2026-10-08/rejudge-2026-10-11/`](https://github.com/Ludion-ai/ludion/tree/main/docs/bench/2026-10-08/rejudge-2026-10-11)).
- **Each change is labeled loud or silent**: loud when code written for the older version fails with an error on the new one, silent when it still runs. The label and its reason are in the keys.

## How answers are graded

- A separate Claude Code run grades each answer: Opus 5.5, no tools, one turn, with the question, the answer key (what a correct answer must say, and the stale answer to watch for), and the answer. The prompt is [`2026-10-08/judge-prompt.md`](https://github.com/Ludion-ai/ludion/blob/main/docs/bench/2026-10-08/judge-prompt.md).
- Grades are **correct**, **wrong**, or **no answer**. Only correct counts. Each grade is saved with the judge's reason (`grades-<run>.json`) and the judge's log (`runs/judge-<run>/`).
- On the site, each result is the number correct out of the questions asked, with its 95% Wilson score interval. The intervals are wide for 15 questions; compare their widths, not only the counts.

## Conditions

- **In a project** ([`2026-10-11-done3/`](https://github.com/Ludion-ai/ludion/tree/main/docs/bench/2026-10-11-done3), the official Done 3 run): Claude Code with its default read-only tools (read, search, the web, and read-only package commands) in a copy of a prepared project with the new versions installed ([`tools/bench/projects/`](https://github.com/Ludion-ai/ludion/tree/main/tools/bench/projects)). It can't write files. "With sync" runs `ludion sync` in the project before each question, against the seed lessons frozen for the run.
- **Without tools** ([`2026-10-11-models/`](https://github.com/Ludion-ai/ludion/tree/main/docs/bench/2026-10-11-models), written to [`models.json`](https://github.com/Ludion-ai/ludion/blob/main/docs/bench/models.json)): each model answers every A question twice with no tools. A model knows a change when both answers are correct. `ludion sync` leaves out the lessons a model is measured to know.
- A model with no run under a condition is shown as not measured, never estimated.

## Cost

- Every answer and every grade records what it cost (`costUsd` in `answers-<run>.json` and `grades-<run>.json`). The site's method page sums them per run.
- A spending cap is set before each run (`--cap-usd`), and the run stops before passing it.

## Running it again

[`tools/bench/src/freshbench.ts`](https://github.com/Ludion-ai/ludion/blob/main/tools/bench/src/freshbench.ts) runs a question set under a condition and saves the answers and logs (`run`), then grades them (`judge`). [`tools/bench/src/projects.ts`](https://github.com/Ludion-ai/ludion/blob/main/tools/bench/src/projects.ts) prepares the projects. The exact commands for a run are in its folder's README.
