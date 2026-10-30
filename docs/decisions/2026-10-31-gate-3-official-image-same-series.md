# 2026-10-31 — Gate 3 for a same-series patch of an official image

**Owner decision, 2026-10-30 23:30 JST** (the owner's words to the owner's Claude chat, among them 「1〜4OK」), recorded by the chat in ludion-ops#1 comment 6525272283, decision 3. The owner's words are quoted in docs/decisions/2026-10-31-counts-instead-of-days.md.

## Decided

1. **For a patch within the same series of an official image, gate 3 is: the build passes, it starts, and, if there are tests, all of them pass.**
2. **A missing test alone is not a reason to stop.**

The board does not say how gate 3 checks that it starts, or which images count as official; both are 不明 here.

## When it takes effect

Not yet. CLAUDE.md's Product says that nothing passing on old is undecidable, and CLAUDE.md wins until it is changed. The change is in LC0, a protected PR (comment 6525272283, 4), which the owner merges (comment 6528291928, 2; comment 6529705640, 7). Until LC0 is merged, gate 3 stays as CLAUDE.md has it, a test included, for Node.js official images and same-tag rebuilds too (comment 6529705640, 5 and 6).

## Undo

A later decision of the owner's, with its own record.
