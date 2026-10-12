# Codex inspection fixes — 2026-10-12

Base: `4fd88fb902320a0432f71d45f2cc659062e97948`. Branch: `codex/fix-ludion-sync-trust`. This is implementation validation, not another paid FreshBench or a new product-value measurement.

## Reproductions and acceptance

- A published correction replaces an old public lesson whose local ledger copy remains: actual CLI sync emits only the correction, including with a legacy server that has no retirement metadata.
- A subject loses its last active lesson: `inactive_ids` still suppresses the old ledger copy, while an unrelated private lesson remains.
- A private correction outside the installed version range still suppresses the obsolete lesson; version filtering does not revive it.
- A public PR pending merge remains usable privately. Without retirement metadata or offline, it carries `public status unknown`, rather than a present public verification claim.
- Different manifest/shard build timestamps fail sync instead of combining retirement metadata with an older active set.
- An inverted claim whose quote-presence check passes is explicitly labeled as quote presence, with the semantic limitation included in CLI, MCP, index and llms.txt. It is not claimed to be rejected by a semantic prover. Human review is still needed to establish the kind, range and signal.
- An extracted CLI tarball is checked on the declared minimum Node 22.19.0: help, online sync to an isolated project, evidence-scope output, and a guarded source-check rejection of localhost. No arbitrary lesson code runs on the host.

The Windows local checkout passed typecheck and build. The recorded suite below passes 401 tests and the site E2E passes 6 tests with 1 optional screenshot test skipped. `test.log`, `e2e.log` and `tarball-smoke.log` are the direct outputs for this check. Those counts are test coverage, not a product accuracy claim.

The tarball is built from the current CLI workspace; its version metadata remains 0.1.2, but it is an unpublished local build. It must not be confused with the npm artifact at that version, which is unchanged. Release requires a new version and owner's approval on npm, followed by updating the pinned plugin to that published version.

## Review boundary

Fresh-context Codex static review found no actionable code blocker. It is not an Opus verdict. The one restricted read-only Opus invocation, using the existing account, returned `usage_limit_reached` before model generation. The mandatory Opus review in `docs/decisions.md` remains BLOCKED; the protected PR must stay in draft and unmerged until that review and owner approval are complete. No extra benchmark or paid account was used as a workaround.
