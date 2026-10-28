# 2026-10-29: Read-only Python inventory

`packages/cli/src/security/readonly/python.ts` reads exact Python package versions for OSV's PyPI ecosystem. It does not patch, plan or run project code, and nothing calls it yet.

- **Lock files are the inventory.** Every lock present (`uv.lock`, `poetry.lock`, `Pipfile.lock`) is read and the packages are combined. Combining several locks can only add packages to check, so it can miss nothing.
- **requirements.txt adds its exact `name==version` pins.** A lock's direct and indirect marks win. requirements.txt marks a pin direct only when no lock lists that name at that version.
- **Only registry packages are checked.** In uv, these are packages with a `registry` source. In Poetry, PyPI or a `legacy` index. In Pipfile.lock, an exact `==` version. Git, URL, path and directory sources are listed as limitations, and so are editable packages other than the project itself: an editable checkout can be third-party code.
- **The project itself is skipped and named in `scope`.** That is uv's editable or virtual package at `.`, the members in `[manifest] members`, a `"path": "."` entry in Pipfile.lock, and `.` or `-e .` in requirements.txt. OSV has no advisories for it.
- **uv.lock may use `[[distribution]]`, the old name for `[[package]]`.** It is read the same way, because uv still installs from it. A lock with both names is refused, as uv refuses it.
- **Unknown top-level entries are a limitation.** In uv.lock or poetry.lock, the reader cannot see what is inside them.
- **Unknown lock format versions are not read.** These are uv `version` other than 1, Poetry `lock-version` with a major other than 1 or 2, and `pipfile-spec` other than 6. The file contributes no packages and one limitation.
- **A TOML line the reader cannot parse fails the whole file**, with the file name and line number. The reader handles a strict subset of TOML that matches `tomllib` on real uv 0.11 and Poetry 1.8 and 2.4 locks. Skipping a line could hide a name, version or source.
- **Direct marks that cannot be read become a limitation.** This covers a missing or unreadable pyproject.toml or Pipfile beside a lock, and uv dependency lists that cannot be read exactly. Nothing is marked direct then.
- **Requirements no lock covers are not guessed.** A pyproject.toml with requirements but no uv.lock or poetry.lock produces one limitation. So does a Pipfile with packages but no Pipfile.lock, even when another lock exists. A pyproject.toml with only tool settings declares nothing, so it adds none.
- **requirements.txt is read the way pip reads it.**
  - Lines split on `str.splitlines()` boundaries (CR, LF, VT, FF, FS, GS, RS, NEL, LS and PS).
  - Backslash continuations, comments and whitespace follow pip's rules, using Python's whitespace set. A differential against pip 26.2.1 `parse_requirements` on 24 crafted files gave identical pins.
  - Text that does not read the same as UTF-8 throws. That is a UTF-16 or UTF-32 file, NUL or undecodable bytes, or a PEP 263 coding cookie other than UTF-8; an ASCII-compatible cookie is allowed on pure ASCII text. Such a file is never read as one comment line.
- **Environment markers are not evaluated.** Every locked package is listed for all environments, and requirements.txt pins that have markers are named in a limitation. This can over-report, never under-report.
- **Other requirements files are named but not read.** These are any `*requirements*.txt` (such as `dev-requirements.txt`) and a `requirements/` directory, and they show up even when they are the only Python files in the project. `-r` and `-c` includes are not followed.
- **Text copied from a file into an error or limitation is bounded and escaped.** It is cut to about 200 characters, with control, line-separator, bidi and zero-width characters escaped.
- **Deep input fails with an ordinary error, not a stack overflow.** Key paths are capped at 32 parts, nesting at 32 levels, and nothing recurses or spreads over file-sized lists.
- **OSV format, checked live on 2026-10-29.** OSV's PyPI matching normalizes names (`Jinja2`/`jinja2`, `python_multipart`/`Python.Multipart`) and PEP 440 versions (`2.19`/`2.19.0`/`2.19.0.0`, `3.2rc1`/`3.2.0rc1`, `1.13.0+cpu`). So versions are sent exactly as the lock writes them, and names in PEP 503 form.
