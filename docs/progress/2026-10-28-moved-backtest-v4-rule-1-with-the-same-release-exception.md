## 2026-10-28 — Backtest v4: rule 1 with the same-release exception

The definitions were committed before either script ran: e995557 at 15:04 JST (#150), the stricter amendments 08aa452 and 17b55b7 (#151), and f78c931 at 15:36:07 JST (#151, the exact wording of the publisher-name rule, docs only; pushed by 15:36:11, when its CI started). (f78c931 added 2026-10-28, cycle 2.) Scripts: `tools/backtest/src/fixes-v4.ts` and `malicious-v4.ts` (5ef3a5f). They ran in Docker from 15:37 to 15:48 JST. Data: v3's OSV export, registry and deps.dev, read 2026-10-28. Each result is computed with and without the exception on the same data; without it, the run reproduces v3's numbers exactly. Results and raw data: docs/bench/2026-10-28-backtest-v4/.

Gate: **not met**. The delay gates are met: exploited 16.4h (n = 6), high 0h (n = 21), normal 41.5h (n = 138). "Every malicious version stopped" is not met at any wait:

| Wait | Stopped | Missed | Unknown |
| --- | --- | --- | --- |
| 12h and 24h | 990 of 1,148 | 1 | 157 |
| 72h | 1,052 | 1 | 95 |
| 168h | 1,071 | 1 | 76 |

- **Genuine fixes.** The exception removes all 29 of rule 1's stops on the 200 genuine fixes, 14 of which rule 1 stopped alone. It allowed 69 versions in 30 updates: 29 through provenance with the same repository, workflow and commit, and 1 through the publisher branch (@apollo/composition). 14 updates go from stop to ready (except build). Stops drop from 49 to 35, and the 15 remaining former rule-1 stops are next releases stopped by today's deprecation.
- **Malicious, what the exception let in.** Nothing: no malicious version was allowed as a sibling, and none is selected only because the exception unblocked a tree. The 7 versions published before the T of a fix that selects them are v3's 7. The miss is the same, @ensdomains/buffer 0.1.1 (a 2023 version, record in 2025); the other six are caught by the re-query.
- **Malicious, what the exception changed.** loliloli 1.0.108 (12h to 72h) and @alexcolls/nuxt-ux 0.6.2 (72h) go from stopped to unknown, not missed. n8n fix trees that rule 1 stopped now resolve with branches the registry no longer serves, and the registered rule counts those as unknown.
- **Unverified.** Gate 2's provenance, scripts and publisher remain unverified for 1,140 of the 1,148 removed versions.
- **Second execution.** A second, diagnostic execution (baafc36) only added the fixes behind each unknown, and gives identical counts.

