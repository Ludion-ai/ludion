## 2026-10-28 — Packagist advisories in Composer plans

Composer scans and plans now read Packagist's advisory API next to OSV and take the later fix. New tests: Packagist's later fix wins over OSV's, OSV's later fix is kept, a Packagist-only advisory is found, a fix landing in the next range moves on, unaffected and empty answers stay clean, no same-major fix and unreadable ranges block, and an outage, a missing field, an unrequested name, a record for another package and an invalid id all fail the scan; npm inventories do not query Packagist. Local run in Docker (node:24-slim, no network, read-only root, non-root): typecheck passed; packages tests 176 passed. The site build needs git and was not run in the container; CI runs the full suite.

