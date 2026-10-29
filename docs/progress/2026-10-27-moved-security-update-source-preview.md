## 2026-10-27 — Security-update source preview

Repurposed the active home/setup copy using the existing visual system. Added init/scan/patch/watch for exact-version, single-stage official PHP images, with official same-branch security-release lookup, offline baseline/candidate validation, digest pinning, source-change and policy-change checks, local evidence and opt-in Dockerfile application. Reused the capability timeout runner and central Docker argv builder; legacy client/data/MCP compatibility remains. Archived old product documentation and updated current engineering direction.

Validation: typecheck, workspace and sample builds; 666 tests passed / 7 skipped, security adapter 25 passed, browser 29 passed / 2 skipped, screenshot capture 36 PNGs. Real Docker success, validation-only, intentional candidate failure and intentional baseline failure behaved as specified; failure cases left source unchanged. Dependency audit went from 14 findings to 0 after compatible remediation. Evidence: docs/bench/2026-10-27-security-pivot/. No production deployment or npm publish. Remote CI and protected-file independent review pending.


### Security preview — independent review corrections

The independent reviewer reproduced a stale validated result in validation-only mode and a missed empty-directory source change, and found watch stop did not cancel pending apply. Fixed all three: freshness check for both modes, directory identities/modes plus preserved copy modes, and cancellation gates after async work and before apply. Stop latency is explicitly documented: a running Docker step may finish, but pending application is cancelled. Added regressions. Final local results: 673 passed / 8 skipped overall, security 32 passed / 1 Windows mode skip, all 31 browser checks passed with screenshot capture enabled, 36 refreshed PNGs, and all four real Docker scenarios rerun successfully. Prior remote CI also passed; new-head CI and final protected-file review remain gates.


