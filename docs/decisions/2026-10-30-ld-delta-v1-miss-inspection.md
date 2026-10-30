# 2026-10-30 (LD) — Delta v1: one miss explained with counts beyond the analyzer's facts

Section 6 of `2026-10-30-ld-delta-v1-definitions.md` says each missed malicious version's reason is "written from the analyzer's facts (which files changed, which capabilities the changed files already had), never by reading the code". For one miss, @react-native-aria/switch 0.2.5 (MAL-2025-4789), the analyzer's facts say only that one code file changed and every count is zero in both versions. They do not say why a version the record describes as connecting to a command-and-control server shows no capability at all.

**The departure.** After the result was written, that one file was measured in both versions by `docs/bench/2026-10-30-delta-v1/scripts/inspect-miss.ts`. 
- **The committed script** is the one that ran, except for two changes:
  - the header comment, which now lists everything it prints;
  - the file's path, which was written into the script and is now taken as its argument, so that no path of the malicious version is committed.
- **Where it ran.** 2026-10-30 at about 07:30Z, in node:24-slim, with:
  - user 1000 and a read-only root;
  - a tmpfs /tmp;
  - the repository volume mounted read-only;
  - no credentials.
- **What it read.** It fetched both tarballs from the registry and compared each with the packument's sha512 integrity. It printed `integrity ok true` for both. The script does not stop on a mismatch; it prints the flag.
- **What it printed:**
  - the file list;
  - the counts below;
  - the module names given to `require`;
  - the analyzer's counts above zero.

  No line of code was printed, read on the host, or committed.
- **Order of events.** This departure was first published in the README (commits 6d9960a and 20810f5) without this entry. It was recorded here only after a fresh-context review flagged it (PR #216, comment 6517546396). See `docs/mistakes/2026-10-30-delta-v1-records.md`.

**What it printed for the changed code file**, previous version → 0.2.5:

| Measure | 0.2.4 | 0.2.5 |
| --- | --- | --- |
| Characters (UTF-16 units; the file has 0 non-ASCII characters, so also bytes) | 283 | 4,545 |
| Lines | 14 | 14 |
| Longest line | 46 | 4,302 |
| Lines of 1,000 characters or more | 0 | 1 |
| Highest entropy of a line of 200 characters or more (bits per character) | — | 5.20 |
| Longest run of 20 or more spaces or tabs anywhere in the file (0: no such run) | 0 | 836 |
| `require` targets | the package's own module | the same |
| Occurrences of `global[` | 0 | 2 |
| Occurrences of `fromCharCode` | 0 | 0 |
| The analyzer's counts above zero | none | none |

**What is inferred, not printed:**
- That the code added in 0.2.5 is on its longest line. 0.2.4's longest line is 46 characters, and 0.2.5 has the only line of 1,000 or more.
- That the entropy of 5.20 belongs to that line. The script prints the highest entropy over all lines of 200 characters or more.
- That the 836-character run of spaces or tabs is on or before that line.
- That `global[` means computed property lookups on the global object.

**What it changes:** nothing counted.
- The miss stays a miss, every count stays as the execution wrote it, and no definition changes.
- The README's reason for this one version cites these numbers and names this entry. The reason for the other miss uses only the analyzer's facts.
- Any idea the numbers suggest for a v2 (lower thresholds, a whitespace-padding marker, computed access to `global`) needs a new definitions entry and a new run.

**Paths.**
- No file this lane adds names a file path of a malicious version. (main's v5 results, which this lane reads, do hold such paths in their disputed evidence.) The README does not, the results JSON never held one (`tools/backtest/test/delta-v1-results.test.ts`), and the script takes the path as an argument.
- The script's output, which did list both versions' files, was not committed.
- The branch's earlier commits named paths of this version:
  - 6d9960a and 20810f5 named four paths in the README;
  - 5f96c3a and eb65fee named one path in the script.

  A squash merge keeps them out of main.
