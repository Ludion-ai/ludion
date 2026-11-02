# LPOLDOC: the owner's plan copied into docs/decisions (2026-11-02)

What was copied: the plan 「Ludion 完成の定義：最終決定（11-02）」 (28,602 bytes), into docs/decisions/2026-11-02-definition-of-complete-final.md, with seven lines added above it and its operational lines removed. docs/decisions/2026-11-02-definition-of-complete-corrections.md holds part of what was decided after the plan was written, says that later changes exist outside it, and wins over the copy within the limit its third line gives. Nothing else in Ludion changes in this PR.

The body does not have the plan's sha256, by design: it is the plan less the lines its preamble lists, and each removed line stays as an empty line or empty table row so that the plan's line N is the record's line N+7.

These rows ran inside Docker (node:24.22.2-alpine, no network, read-only mounts).

| Check | Result |
|---|---|
| sha256 of the source file | 1e301f80a4b389bdc9623b4db7e912eff8fbfc7d97b2f1495b79f0a3a1b6c5c7 |
| sha256 of the record from line 8 on (`tail -n +8`) | 96d651eedc7da5536d2448e44c06df6f107b4fe388962dc20cecaea813bfaf80 |
| Bytes, source / record from line 8 on | 28,602 / 27,987 |
| Lines, source / record from line 8 on | 279 / 279 |
| Lines that differ (`diff -U0`, hunk headers) | 107, 111, 112, 173, 230, 245, 268, 269: the preamble's list |
| Source with those lines' character ranges cut, against the record from line 8 on | `cmp`: identical |
| Numbers in the cut ranges, leaving out list markers and the digit of a name | 3: one each on :107, :111, :112 |
| `npx vitest run tools/records`, on a copy in a Docker volume | 2 files, 19 tests passed |
