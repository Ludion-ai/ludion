# 2026-10-29: Go read-only inventory (go.mod)

`packages/cli/src/security/readonly/go.ts` reads go.mod for a read-only OSV scan (ecosystem `Go`). Nothing is patched.

- **Inventory source: go.mod's require list.** Since Go 1.17 it names every module the build needs. `// indirect` gives `direct: false`, using Go's own rule: the comment is exactly `indirect`, or starts with `indirect;`. go.sum is not the inventory: it also records checksums of modules outside the build list. A `go` line older than 1.17 is a limitation, and so is a missing one (Go then assumes 1.16): the require list may be incomplete.
- **Versions exactly as go.mod writes them.** OSV matched golang.org/x/text at `v0.3.5` and `0.3.5` the same way (GO-2021-0113 among six records). Pseudo-versions and `+incompatible` matched with or without the `v`. Only full versions are accepted (`v1.2.3`, with a prerelease or `+incompatible`). `v1.2`, `latest` and other build metadata throw. So does a version whose major does not match the path's major-version suffix, following Go's `module.CheckPathMajor`, including gopkg.in `.vN`: for example `example.com/a v2.0.0`, `example.com/a/v2 v1.0.0` or `gopkg.in/yaml.v2 v3.0.0`.
- **Replaced requirements are left out, never substituted.** The build does not use the original, and Ludion does not check the replacement. A local-directory replacement and a module@version replacement each become a limitation; the second names both modules. As in Go, a replacement for the exact version wins over one for every version.
- **Unreplaced paths without a dot.** A required path with no dot in its first element and no replacement is a limitation too: Go cannot download it. This also keeps a module named `stdlib` from being queried as the standard library.
- **Excluded requirements are dropped, as Go drops them.** A requirement on a version that go.mod's own `exclude` names is left out and listed. Any other version Go might use instead is not checked.
- **The Go distribution only from a `toolchain goX.Y.Z` line.** It is checked as two OSV packages at `X.Y.Z`, without the `go` prefix (OSV does not match `go1.22.5`):
  - `stdlib`: the standard library compiled into the program.
  - `toolchain`: cmd/go and the other build-time commands (for example GO-2023-2042).

  Even then a limitation always says that the toolchain line may not be the Go that builds. Under GOTOOLCHAIN=auto the line is only a minimum, and under GOTOOLCHAIN=local (which the official golang Docker images set) it is ignored. So advisories for the toolchain in use may be missing. In the other cases neither package is checked, and a limitation says the toolchain in use is unknown:
  - there is no toolchain line (the `go` line is a minimum, not the toolchain in use);
  - the line is `toolchain default`;
  - the name is not a release (an rc, or a custom suffix);
  - the toolchain is older than the go line.
- **Other directives.** `retract`, and excludes that match no requirement, are validated and ignored. So are `godebug`, `tool` and `ignore`. Unknown directives become one limitation that names at most 10 of them and counts the rest; they are not an error, so a directive added by a newer Go does not stop the scan.
- **Malformed input throws** with its line number. This includes a byte-order mark, which Go rejects.
- **Bounds.** Requirements are capped at 2,000, the same as the package cap. That cap bounds every per-module limitation.
- **go.work** in the project root is a limitation: its modules and replacements are not read.
