# 2026-10-31 — Gate 3 for a same-series patch of an official image (proposed, waiting for the owner)

**Proposed 2026-10-30 23:30 JST, waiting for the owner's OK on its scope sentence.** The owner's Claude chat listed it as decision 3 of four in ludion-ops#1 comment 6525272283, and the owner answered 「1〜4OK」 (the owner's words are quoted in docs/decisions/2026-10-31-counts-instead-of-days.md). Under CLAUDE.md's Scope rule (How we work; line 18 at main 47a21a9), that answer does not approve a narrowing of a gate: an OK to a list does not approve a scope change inside it. The chat called this its own error in presenting the list (comment 6531046171, 1, answering the audit in comment 6530612087).

## Proposed (not decided)

1. **For a patch within the same series of an official image, gate 3 would be: the build passes, it starts, and, if there are tests, all of them pass.**
2. **A missing test alone would not be a reason to stop.**

The board does not say how gate 3 checks that it starts, or which images count as official; both are 不明 here.

## When it takes effect

Not yet. Waiting for the owner's OK on the scope sentence, and without effect until CLAUDE.md's gate 3 (line 31 at main 47a21a9) is changed in LC0 (comment 6531046171, 1). CLAUDE.md's Product says that nothing passing on old is undecidable, and CLAUDE.md wins until it is changed. The change is in LC0, a protected PR (comment 6525272283, 4), which the owner merges (comment 6528291928, 2; comment 6529705640, 7). Until LC0 is merged, gate 3 stays as CLAUDE.md has it, a test included, for Node.js official images and same-tag rebuilds too (comment 6529705640, 5 and 6).

## Undo

Taking effect needs the owner's OK on the scope sentence and LC0; until then there is nothing to undo.
