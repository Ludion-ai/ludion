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
- **Registration.** Python, Go and Rust are registered with `PYTHON_FILES`, `GO_FILES` and `RUST_FILES`. `PYTHON_FILES` also names Pipfile, which the Python reader reads on its own, and setup.py and setup.cfg, which it never reads. A project whose only Python file is another requirements file (requirements-dev.txt) is not scanned, because no registered name is present.
- **Never clean when dependencies are declared where Ludion does not read** (#189 reviews). Fail closed, not by a list of tools. A list of seven tools missed Briefcase, workspace roots, tox and cibuildwheel, and over-reporting is the accepted direction.
  - Without a lock Ludion reads (uv.lock, poetry.lock or Pipfile.lock), pyproject.toml is always a limitation, even with only `[tool.black]`.
  - Beside a lock, a `[tool.*]` key whose name contains "depend", "require", "deps", "members" or "legacy_tox_ini" is a limitation. That includes ruff's `required-version`.
    - The walk covers tables, arrays of tables and inline arrays. It stops eight levels deep, and that stop is itself a limitation.
    - `[tool.uv]` is exempt only beside uv.lock, and `[tool.poetry]` only beside poetry.lock.
  - setup.py is always a limitation.
  - setup.cfg is read for its section headers only, as configparser finds them. A header that names "options", once whitespace and control characters are removed and case is ignored, is a limitation; setuptools reads every such section. Tool sections alone add nothing.
- **No expansion of workspace members** (#189 round 3). Expanding `dir/*` was quadratic in members × exclude and unbounded in repeated patterns, so it was removed.
  - Cargo's `[workspace]` and uv's `[tool.uv.workspace]` members are read as literal paths only: deduplicated, at most 1,000, and inside the project.
  - A pattern, an `exclude` list, more than 1,000 members, or a member whose manifest cannot be read gives one limitation.
  - It is linear in the input's length. That covers both the number of entries and the length of one entry: exclude entries are never read, and member entries are trimmed with string code. A 4 MiB members and exclude list takes about 0.3 s, and so does one 4 MiB exclude entry.
- **No quadratic pattern over file text** (#189 round 4). Two end-anchored runs were quadratic in one long string: `[\s…]+$` in setup.cfg header handling, and `/\/+$/` on exclude entries.
  - Every regex in readonly/*.ts that runs on file text was audited. Each one with an end-anchored quantified run is now string code or a start-anchored pattern: the setup.cfg leading strip, the Go major-version suffixes, the Cargo source `#fragment`, and the member trims.
  - The remaining unanchored patterns begin with a literal, or have no quantified run, or run on input already capped in length (Go paths at 300 characters, PEP 440 versions at 100, names at 200).
  - readonly-redos.test.ts feeds each such function a 4 MiB adversarial string and requires under a second.
  - The Go lexer now slices each word once instead of concatenating it character by character, so a 4 MiB word takes 0.09 s, not 0.5 s.
- **A lock must be its manifest's** (#189 review). Each reader reads the manifest beside the lock it reads.
  - uv.lock: a limitation when it has no project package, when it does not name pyproject.toml's project, or when pyproject.toml cannot be read. Also when it lacks a `[tool.uv] dev-dependencies` name (compared like `[dependency-groups]`), or a literal `[tool.uv.workspace]` member's package.
  - poetry.lock, Pipfile.lock and uv.lock: a limitation when they do not list a requirement the manifest declares, other than the project itself. An unreadable manifest is a limitation even beside an empty lock.
  - poetry.lock's lock-version is read by one predicate for parsing and for this comparison ("02.0" is 2.0).
  - Cargo.lock: a limitation in any of these cases:
    - Cargo.toml's package is not among the lock's workspace members;
    - a crate that Cargo.toml's dependency tables declare is missing from the lock. The tables are `[dependencies]`, `[dev-dependencies]` and `[build-dependencies]`, also under `[target.*]`. Crates compare by `package` for a rename (also through `[workspace.dependencies]`), with `-`/`_` and case alike;
    - a literal `[workspace]` member, named in its own Cargo.toml, is not one of the lock's members;
    - Cargo.toml names another workspace root (`package.workspace`);
    - Cargo.toml cannot be read.

    Only validated crate names, counts and a line number are printed, since dependency entries can carry credentials.
  - Versions are not compared with the manifest's ranges.
- **Unsupported list.** Unchanged while no reader is registered (requirements.txt, pyproject.toml, go.mod, Cargo.lock, build.gradle, build.gradle.kts). A file leaves it only when a registered reader ran for it; that reader's check (a result or an error) then reports it. build.gradle(.kts) stay unsupported.
- **Nothing dropped silently.** A reader that returns no inventory while one of its files is present, or an inventory of another ecosystem, gives an error check. A present file that the reader neither lists in `files` nor names in a limitation gets the limitation "<file> is present but was not read." d575c5d had a `COVERED_BY` exception for a manifest beside a lock the reader read. It was dropped once the readers read those manifests themselves. Every present file is read before the reader runs and compared after the OSV lookup, so a change during the scan gives an error, as for the other inventories.
- **No update policy.** `init`, `patch` and `watch` refuse `--ecosystem python|go|rust`, and a saved ludion.security.json naming python, go, rust, PyPI, Go or crates.io is refused with the same message.
