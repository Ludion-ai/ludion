# LPOLDOC: the owner's plan copied into docs/decisions (2026-11-02)

What was copied: the plan 「Ludion 完成の定義：最終決定（11-02）」 (28,602 bytes), into docs/decisions/2026-11-02-definition-of-complete-final.md, with three lines added above it. Nothing else in Ludion changes in this PR.

The sha256, `cmp` and byte rows ran inside Docker (node:24.22.2-alpine, no network). The search behind the replacements row is a text search over the source file, run on the host; it runs no code from the file.

| Check | Result |
|---|---|
| sha256 of the source file | 1e301f80a4b389bdc9623b4db7e912eff8fbfc7d97b2f1495b79f0a3a1b6c5c7 |
| sha256 of the record from line 4 on (`tail -n +4`) | 1e301f80a4b389bdc9623b4db7e912eff8fbfc7d97b2f1495b79f0a3a1b6c5c7 |
| `cmp` of the two | identical |
| Bytes, source / record from line 4 on | 28,602 / 28,602 |
| Replacements made in the body | 0: a search of the source found no name or comment number of the operations board and no session id |
| Lines the records test asked to add | 0 |

The three added lines say when the owner made this the plan, the source's sha256, and that CLAUDE.md wins where the two conflict, until the protected PR lands.
