# LPOLPR: the owner's plan in CLAUDE.md (2026-11-02)

Sentences only: no code, test or workflow changed. The decision and its sources: docs/decisions/2026-11-02-policy-into-claude-md.md. Started from main ecbfd3823704fc00c852eac8186576b74531df5d.

| What | Result | How it was checked |
|---|---|---|
| CLAUDE.md's size | 13,104 → 13,997 bytes; the limit is under 14,000 | `wc -c`; records.test.ts, "stays under 14,000 bytes" |
| CLAUDE.md's lines | 66 → 66 | `wc -l` |
| Every rule docs/mistakes quotes is still in CLAUDE.md | Yes | records.test.ts, "every one names a check that exists or a rule CLAUDE.md still says" |
| tools/records' tests | 19 of 19 pass (2 files) | `npx vitest run tools/records` in node:24-slim, `--network none --memory 4g`, on a copy of the tree in a Docker volume |
| The plan's sha256 | 1e301f80a4b389bdc9623b4db7e912eff8fbfc7d97b2f1495b79f0a3a1b6c5c7 | `sha256sum` |
| 0/2's 95% upper bound | 0.7764 | 1 − 0.05^(1/2), by `awk` |
| What the product has of these sentences | Nothing | The counts in docs/status.md, "Where CLAUDE.md says more than the code" |

The rest of the test suite was not run here; CI runs it on the PR.
