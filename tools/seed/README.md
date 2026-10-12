# tools/seed: the seed pipeline

Drafts Ludion lessons from a package's release notes, checks them, and has them reviewed, so a person only signs (the PR) and corrects. Decisions and why: `docs/decisions.md`, "The seed pipeline". Every step reads and writes JSON in one run folder; rerunning a step resumes it.

```sh
D=docs/bench/<date>-seed/<subject>
node tools/seed/src/cli.ts collect $D --package wrangler --range ">=4.149.0"   # or --range "*" --since 2026-04-15
node tools/seed/src/cli.ts triage  $D                                         # sonnet, no tools
node tools/seed/src/cli.ts draft   $D --kinds default,behavior,deprecated,renamed,removed --signal silent
node tools/seed/src/cli.ts check   $D                                         # schema, lessonProblems, quotes (no Docker)
node tools/seed/src/cli.ts review  $D                                         # fresh-context opus, the seed checklist
node tools/seed/src/cli.ts revise  $D --round 1 --scope check                 # local-check problems only, back to the drafting model (sonnet)
node tools/seed/src/cli.ts check   $D --round 1 && node tools/seed/src/cli.ts review $D --round 1   # unchanged drafts keep their review
node tools/seed/src/cli.ts revise  $D --round 2                               # findings, once: rules 1, 7, 8 to opus, the rest to sonnet
node tools/seed/src/cli.ts check   $D --round 2 && node tools/seed/src/cli.ts review $D --round 2
node tools/seed/src/cli.ts lessons $D --round 2 --out lessons                 # files for the subject's PR (lessons kept earlier are left out)
node tools/seed/src/cli.ts ci      $D --pr <n>                                # CI's Docker results for that PR
node tools/seed/src/cli.ts fix     $D --out lessons                           # one repair round for CI failures
node tools/seed/src/cli.ts bench   $D --out lessons                           # models labels and the harm check
node tools/seed/src/cli.ts summary $D
```

- Model calls go through Claude Code headless (`tools/bench/src/agent.ts`) with a run-only configuration. Drafting agents read untrusted text (release notes, pull requests, package code), so they can read and write files in their own folder and nothing else; they never run code. Lesson tests run only in CI's Docker.
- Large files (unpacked packages, agent folders, CI results) go to `../ludion-seedwork` next to the repo, or `LUDION_SEED_CACHE`.
- `watch.ts` lists new stable releases of covered packages (the nightly `seed-watch.yml`); `score.ts` scores candidate subjects; `questions.ts` writes FreshBench questions for a new subject from its changelog; `calibrate.ts` runs the reviewer on accepted lessons.
