# Multi-ecosystem security update check — 2026-10-27

Real local Docker runs against copies of the committed intentionally vulnerable examples, using the built source CLI and live OSV/package sources. Both baseline and candidate business-contract smoke tests pass. Candidate inventory recheck has no known findings. These are not exploit regression tests, production deployments, performance benchmarks or security certifications. Caches were warm; elapsed time is one observed run, not a latency guarantee.

| Ecosystem | Advisory matches before → after | Baseline / candidate | Elapsed ms | Result |
| --- | --- | --- | --- | --- |
| npm | 5 → 0 | true / true | 24844 | applied |
| composer | 2 → 0 | true / true | 40306 | applied |
| maven | 2 → 0 | true / true | 23681 | applied |

The receipts contain exact before/after package versions, advisory IDs, image digests, source hashes, application commands and changed-file hashes. Host paths are removed from this committed evidence; the operator's full local receipts remain under .ludion/security. Composer archive evidence records the original and validated final URLs plus SHA256. The prior PHP adapter's real success, validation-only, baseline-failure and candidate-failure evidence remains under ../2026-10-27-security-pivot/.

During integration, npm's root-created cache permissions and an unsupported Composer install option failed before any source application. Both were fixed; the successful runs here use the corrected acquisition path. An earlier minimum Composer fixed floor was rejected by the native solver due to newer Packagist advisories; same-major bounded resolution now selects a later compatible fix while retaining native blocking.

Local verification: typecheck and workspace/sample builds pass; 714 tests pass and 8 skip (including Windows file-mode checks); npm audit reports zero findings. All 31 browser checks pass with 36 refreshed screenshots; light/dark axe, 320px reflow, 200% text and reduced-motion checks pass. Home JavaScript is 32.1 KB gzipped (60 KB budget). Independent review and remote CI remain release gates. npm has not been published and production deployment is separate.
