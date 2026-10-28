# 2026-10-29 — Read-only scans for Python, Go and Rust: the framework

`ludion scan` reads PyPI, Go and crates.io inventories through registered readers (packages/cli/src/security/readonly/) and reports OSV's known advisories. Nothing is planned or applied for these ecosystems.

- **No version comparison.** A finding is OSV's match on the exact name and version. Its `fixed_versions` are the fixed versions OSV lists for that package and ecosystem, copied as strings for display: PEP 440 and Go versions are not semver, so Ludion does not say which one applies. Only SEMVER and ECOSYSTEM ranges are read (a GIT range lists commits). PyPI names are matched in OSV records by PEP 503 normalization, Go and crates.io names exactly.
- **Names fail closed.** Before any request, each name must be valid for its ecosystem: a PEP 508 name for PyPI (no extras or markers), a module path (golang.org/x/mod's CheckPath rules) or `stdlib`/`toolchain` for Go, and `[A-Za-z0-9_-]{1,64}` for crates.io. A reader bug such as `requests[security]` would otherwise be a query that matches nothing and looks clean. A PyPI package listed under several spellings is queried once (PEP 503), and an entry listed twice is direct if either is.
- **Status.** The existing rule: `vulnerabilities_found` with any vulnerability, otherwise `incomplete` when the inventory has any limitation, otherwise `no_known_vulnerabilities`. Withdrawn advisories are left out.
- **RustSec informational advisories.** OSV puts RustSec's kind in `affected[].database_specific.informational` (checked live on RUSTSEC-2024-0375 and RUSTSEC-2021-0145).
  - A finding has `kind: "informational"` only when all of these hold: it is a RUSTSEC record for crates.io, every OSV entry for the crate is marked `unmaintained` or `notice`, and it has no CVE or GHSA alias.
  - Informational findings count neither for the status nor for the exit code.
  - Everything else counts as a vulnerability:
    - `unsound`, which is a memory-safety bug;
    - an unknown kind;
    - a record with no entry for the queried crate;
    - a record with a CVE or GHSA alias. OSV can lack the alias's own record: live, salsa 0.28.0's RUSTSEC-2026-0308 and stable-vec 0.4.0's RUSTSEC-2026-0267 are `unsound` with a GHSA alias that OSV returns 404 for. RUSTSEC-2020-0036 (failure, "unmaintained") names CVE-2019-25010.
- **Unsupported list.** Unchanged while no reader is registered (requirements.txt, pyproject.toml, go.mod, Cargo.lock, build.gradle, build.gradle.kts). A file leaves it only when a registered reader ran for it; that reader's check (a result or an error) then reports it. build.gradle(.kts) stay unsupported.
- **Nothing dropped silently.** A reader that returns no inventory while one of its files is present, or an inventory of another ecosystem, gives an error check. A present file that the reader neither lists in `files` nor names in a limitation gets the limitation "<file> is present but was not read." Every present file is read before the reader runs and compared after the OSV lookup, so a change during the scan gives an error, as for the other inventories.
- **No update policy.** `init`, `patch` and `watch` refuse `--ecosystem python|go|rust`, and a saved ludion.security.json naming python, go, rust, PyPI, Go or crates.io is refused with the same message.
