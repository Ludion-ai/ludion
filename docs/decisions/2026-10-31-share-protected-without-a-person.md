# 2026-10-31 — Measure the share of repositories Ludion can protect without a person

**Owner decision, 2026-10-30 23:30 JST** (the owner's words to the owner's Claude chat, among them 「1〜4OK」), recorded by the chat in ludion-ops#1 comment 6525272283, decision 4. The owner's words are quoted in docs/decisions/2026-10-31-counts-instead-of-days.md.

## Decided

1. **Ludion measures 「勝手に守れる割合」:** in public repositories, the share that Ludion can protect without a person's hands.
2. **It is a yardstick for release.**
3. **How it is counted** (the chat's proposal in the same comment, fixed in a definition PR before counting): ±10% at 95% confidence, so 97 repositories (docs/decisions/2026-10-31-counts-instead-of-days.md), from the same public repositories as LR's sample (Dockerfiles on the official php or node images; not on main). The same comment's plan for that measurement (LR2) counts, in public repositories' Dockerfiles on the official php and node images, besides how far behind their versions are: whether there are tests and whether they look runnable without a network; whether startup can be checked (EXPOSE, HEALTHCHECK); whether a merge deploys automatically (a deployment workflow run on push, vercel.json and the like); whether the runtime is end-of-life. No clone, files fetched only, no third-party code run, the definition committed first.

## Not on the board (不明)

What makes a repository count as protected without a person (the plan's items above are things to count, not that definition); what value of the share release needs; and whether CLAUDE.md's text must change for this.

## When it takes effect

The measurement may start once its definition is committed. Nothing is released before "complete" (CLAUDE.md, Goal).

## Undo

A later decision of the owner's, with its own record.
