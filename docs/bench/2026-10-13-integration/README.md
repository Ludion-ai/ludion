# Integration with main — 2026-10-13

Merge main `f48ade4e9805024ffaf6a3809fc5f0ce2d4e5a06` into PR #67, preserving both sides of the four conflicts. Keep main's CLI version 0.1.4 and package-derived User-Agent, while retaining the hardened shard reader, retirement handling and both test sets. Documentation retains both histories; the current npm staging described by main was performed separately, not by this integration.

Incoming main's model helper forwarded the Actions API key to every condition. Restrict it to explicit `none` (no tools) and `files` (folder-confined pipeline tools) conditions; project/web/ludion and unspecified conditions receive no such credential. `runAgent` passes its condition explicitly. The helper tests use a synthetic sentinel; no actual key read, exfiltration or model measurement was tested.

Fresh install, typecheck and build passed; 454 tests passed across 25 files. `npm audit` reports zero vulnerabilities in the integrated dependency tree. Raw logs/audit are stored here. Candidate/lesson code was not executed on this host. Actual Docker behavior is checked by PR CI. The protected stack still requires completed Opus verdicts, fresh checks and owner merge. No npm approval, publication or deployment was performed by this integration.
