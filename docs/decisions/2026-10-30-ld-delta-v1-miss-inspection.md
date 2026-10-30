# 2026-10-30 (LD) — Delta v1: one miss explained with counts beyond the analyzer's facts

Section 6 of `2026-10-30-ld-delta-v1-definitions.md` says each missed malicious version's reason is "written from the analyzer's facts (which files changed, which capabilities the changed files already had), never by reading the code". For one miss, @react-native-aria/switch 0.2.5 (MAL-2025-4789), the analyzer's facts say only that one code file changed and every count is zero in both versions. They do not say why a version the record describes as connecting to a command-and-control server shows no capability at all.

**The departure.** After the result was written, that one file was measured in both versions. The script was `docs/bench/2026-10-30-delta-v1/scripts/inspect-miss.ts`, committed as it ran. It ran on 2026-10-30 at about 07:30Z, in node:24-slim, with:
- user 1000 and a read-only root;
- a tmpfs /tmp;
- the repository volume mounted read-only;
- no credentials.

It fetched both tarballs from the registry and checked them against the packument's integrity. It printed only:
- the file list;
- byte, line and longest-line counts;
- the highest entropy of a line of 200 or more characters;
- the longest run of spaces or tabs;
- the module names given to `require`;
- the analyzer's counts above zero;
- the counts of non-ASCII characters, of `global[` and of `fromCharCode`.

No line of code was printed, read on the host, or committed.

**What it changes:** nothing counted. The miss stays a miss, every count stays as the execution wrote it, and no definition changes. The README's reason for this one version cites these numbers and names this entry. The reason for the other miss uses only the analyzer's facts. Any idea the numbers suggest for a v2 (lower thresholds, a whitespace-padding marker, computed access to `global`) needs a new definitions entry and a new run.

**Paths.** The README does not name the file paths of malicious versions. The results JSON never held them.
