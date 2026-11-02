# LPOLPR: the owner's plan in CLAUDE.md (2026-11-02)

Sentences only: no code, test or workflow changed. The decision and its sources: docs/decisions/2026-11-02-policy-into-claude-md.md. Started from main ecbfd3823704fc00c852eac8186576b74531df5d. The last change to CLAUDE.md here takes the owner's decisions of 16:18 and 18:36 JST into CLAUDE.md:34; main ace01dc3bbb6a7259547c0c834d36aec8cc36d1c merges with it without a conflict (`git merge-tree`), so it was not merged in.

| What | Result | How it was checked |
|---|---|---|
| CLAUDE.md's size | 13,104 → 13,944 bytes; the limit stays under 14,000 | `wc -c`; records.test.ts, "stays under 14,000 bytes" |
| CLAUDE.md's lines | 66 → 66 | `grep -c ''` |
| Every rule docs/mistakes quotes is still in CLAUDE.md | Yes | records.test.ts, "every one names a check that exists or a rule CLAUDE.md still says" |
| tools/records' tests at the commit and on its merge with main | 19 of 19 pass on each (2 files) | `npx vitest run tools/records` in node:24 pinned by digest, `--network none --memory 4g`, on a copy of each tree in a Docker volume |
| The plan's sha256 | 1e301f80a4b389bdc9623b4db7e912eff8fbfc7d97b2f1495b79f0a3a1b6c5c7 | `sha256sum` |
| 0/2's 95% upper bound | 0.7764 | 1 − 0.05^(1/2) |
| Of what docs/status.md lists under "Since 2026-11-02" | None is built | That list, with its `git grep -iE` counts at ecbfd38; `oldest`, `crawl`, `stop.file\|stopfile` and `revert` count the same at main ace01dc3bbb6a7259547c0c834d36aec8cc36d1c |

The rest of the test suite was not run here; CI runs it on the PR.
