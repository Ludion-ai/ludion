## 2026-10-27 — Shared security workflow across package ecosystems

Expand the same scan/patch/watch pipeline to public npm package-lock, Composer and standalone Maven. Reuse the existing lockfile parser and Docker runner; OSV supplies package advisories, php.net remains the runtime source. Report unsupported and partial inventories instead of inferring safety. A saved patch policy selects one ecosystem; scanning may cover several. No new service or account.

Separate manifest-only acquisition from offline application execution. Pin npm12 with non-registry dependencies blocked; install Composer from redirect-checked pinned archives entirely offline with source references removed; strip Maven's online model to dependencies and use a fixed Central mirror. Baseline and candidate must pass the unchanged application test, candidate inventory must have no known findings, and source/config must remain unchanged. Apply source files only, preserving majors, with recovery journals for multi-file writes. Central Docker scratch paths are fixed per tool.

Reuse the existing site UI and expose the actual four-ecosystem scope and exclusions. Remove Chromium installation from the production deploy workflow because the static build no longer generates browser-rendered bench cards; PR browser checks remain. The npm package remains unpublished. Security smoke tests demonstrate application behavior, not exploit regression coverage.

