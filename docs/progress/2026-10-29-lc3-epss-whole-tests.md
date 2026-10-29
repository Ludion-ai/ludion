# 2026-10-29 (LC3) — the candidate judge after #206: EPSS from the whole list, and failing tests

Main 459659c (#206: EPSS from FIRST's whole daily list, no CVE ID sent) was merged into #203 to resolve the conflict in docs/status.md. Through the judge, `ludion patch` and `watch` on npm candidates now download the EPSS list too, and send no CVE ID.

- **Tests.** The fake registries serve the whole EPSS list instead of api.first.org, and two tests check that no URL or body carries a CVE ID. New tests fail when a refusal is honoured only with `--apply`, when an extraneous folder the candidate removes is not passed to the judge, and when a replaced version that is no longer listed does not extend the wait.
- **Checks.** In Docker, at eec8c06: typecheck and build pass; vitest 29 files, 922 passed, 19 skipped; 17 mutations each fail tests.
- **Real run.** Validation only, on a copy of examples/npm-security, with the CLI built at eec8c06: the same result as at 2055161 (lodash 4.18.0 stopped as deprecated, nothing applied), with the five EPSS scores looked up in the downloaded list.

Details: docs/bench/2026-10-29-lc-gate2-patch/README.md, "LC3".
