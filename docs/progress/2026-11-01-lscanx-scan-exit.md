# 2026-11-01 — LSCANX: `ludion scan` no longer exits 1 for an image move with no security release

**Lane LSCANX**, from main 40ab08a, for item 2 of the first-principles audit (ludion-ops#1, comment 6545633020). Decision: docs/decisions/2026-11-01-scan-exit-non-security-move.md (committed before the code). Mistake: docs/mistakes/2026-11-01-scan-exit-non-security-move.md.

## What changed

- packages/cli/src/security/scan.ts: `securityMove()` counts an official image check only when it has a candidate and at least one newer security release; `attention_required` uses it.
- packages/cli/src/security/cli.ts: scan's exit 1 uses the same `securityMove()`. The text line of a move with no newer security release is `newest release <v> of the line (no newer security release); waits until <t>`, or `its wait ended <t>`; the other lines are unchanged.
- README.md and packages/cli/README.md, line 123; docs/status.md, item 4 and its date line.
- packages/cli/test/scan-exit.test.ts (new, 16 tests over PHP and Node.js): a move with no newer security release exits 0 with `no_known_updates`, during its wait and after it, and the check's result keeps `wait` or `update_available`, the candidate, an empty `security_releases` and `wait_until`; a move with a security release between exits 1 with `attention_required` and `update <v>`, at both clock times; the line's newest release exits 0; beside an unsupported inventory (build.gradle) the move still exits 2; a failed image check exits 2.
- The site's sentences (en and ja) are a separate PR, lane/lscanx-site, since merging apps/site deploys ludion.ai.

## Results (all in Docker, node:24, a clone in the volume ludion-lscanx-w, `--memory 4g`)

| Run | Head | Result |
|---|---|---|
| scan-exit.test.ts, tests before the code | 55f5b83 | 8 failed, 8 passed (the 8 that passed are the "as before" cases) |
| scan-exit.test.ts, with the code | 8adcab5 | 16 passed |
| `npm run typecheck` | 8adcab5 | exit 0 |
| `npm run build` | 8adcab5 | exit 0 |
| `npx vitest run` (every suite) | 8adcab5 | 42 files passed; 1445 tests passed, 25 skipped (1470) |

Mutations of the code, each run against scan-exit.test.ts and undone: 5 of 5 caught.

| Mutation | Failed tests |
|---|---|
| M1 scan.ts `attention_required` back to `candidate !== null` | 4 |
| M2 cli.ts exit 1 back to `candidate !== null` | 8 |
| M3 cli.ts text always `update <v>` | 4 |
| M4 `securityMove()` back to `candidate !== null` (both places) | 8 |
| M5 cli.ts "waits until" and "its wait ended" swapped | 4 |

## Not done

- The audit's item 1 (the wait of a move with a security release between) is the brain's, and is unchanged here.
- `no_known_updates` keeps its name beside a move with no security release (decision, item 3).
- No run against the real php.net, nodejs.org or Docker Hub; they are stand-ins in the tests.
