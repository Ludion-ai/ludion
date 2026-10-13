# Integration with main — 2026-10-13

Merge main `f48ade4e9805024ffaf6a3809fc5f0ce2d4e5a06` into PR #67, preserving both sides of the four conflicts. Keep main's CLI version 0.1.4 and package-derived User-Agent, while retaining the hardened shard reader, retirement handling and both test sets. Documentation retains both histories; the current npm staging described by main was performed separately, not by this integration.

Incoming main's model helper forwarded the Actions API key to every condition. Restrict it to explicit `none` (no tools) and `files` (folder-confined pipeline tools) conditions; project/web/ludion and unspecified conditions receive no such credential. `runAgent` passes its condition explicitly. The helper tests use a synthetic sentinel; no actual key read, exfiltration or model measurement was tested.

Fresh install, typecheck and build passed; 454 tests passed across 25 files. `npm audit` reports zero vulnerabilities in the integrated dependency tree. Raw logs/audit are stored here. Candidate/lesson code was not executed on this host. Actual Docker behavior is checked by PR CI. The protected stack still requires completed Opus verdicts, fresh checks and owner merge. No npm approval, publication or deployment was performed by this integration.

## Async measurement correction

Integrated PR67 CI run [38368454975](https://github.com/Ludion-ai/ludion/actions/runs/38368454975) failed because the home JavaScript test ended while its async response listener still awaited a body. It could also compute an incomplete size. Capture each body promise synchronously, detach the listener after network idle, and await all captured bodies before measuring or ending the test. The focused local browser test passed, observing 2 script responses / 3.5 KB gzipped (local built site, not production). `e2e-size.log` records it. Do not reinterpret the earlier incomplete tally as the real bundle size. Final CI reruns the full suite.

Full integrated artifact stack: fresh install, typecheck and build passed, and 510 tests passed across 29 files (`stack-*.log`). These are local checks; final CI heads and the completed required review are recorded separately in the PR comments.

## Required review

Fresh Opus review completed successfully for each protected PR at the exact integrated heads listed in `opus-review.json`, with no actionable blocker. Full verdict and scoped limitations are in `opus-review.md`. This supersedes the earlier blocked status. The earlier exploratory invocation ended without a verdict and was never counted as approval. After the frozen review package, changes only await the JavaScript response bodies in the E2E test and record validation; protected implementations are unchanged. Owner merge still remains required.

## Consolidation

#69 targets current main directly and contains the reviewed #67/#68 source plus #98, squashed only into the feature branch after its CI passed. `consolidation.json` proves ancestry of the earlier security/runtime heads and identical blobs for all protected files changed by the final PR relative to main. The subsequent agent-boundary/E2E changes are unprotected and judged by tests/CI. One owner merge remains; main and production were not merged/deployed by this work.
