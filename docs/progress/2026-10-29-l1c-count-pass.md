# 2026-10-29 (L1c) — The count gate on a new sample, with the split's fallbacks fixed: not met

docs/bench/2026-10-29-l1c; PR #190. The definitions were registered first (docs/decisions/2026-10-29-l1c-new-sample.md, b0b489a), and the fix is in docs/decisions/2026-10-29-l1c-fix.md.

- **Step 1.** Of the 938 the rerun counted, at most 12 (repository, package) pairs were production because the split fell back. 11 come from a production image read as holding devDependencies, and 1 from a nested project folder. Incomplete sources, the every-copy import fallback and nested bins account for 0. Workspaces and bundledDependencies have no fallback of their own. Peer and optional following (28) is section 2's rule.
- **The fix.** A COPY of one package's folder out of node_modules holds that package (by install path), not every devDependency. It applies to 3 of the 12 (OmniRouteRus). The other 9 cannot be shown dev-only from the files. Five rounds of fresh-context review, plus the automated security review, moved the code only toward production. Recomputed beside the result at each reviewed version: 0 changed pairs in either sample.
- **Count gate, not met on both samples:**
  - **New 100 (the verdict):** npm audit 2,136, judge 998 (2,994 > 2,136; the gate needs ≤ 712).
  - Original 100: 1,867 and 935 (2,805 > 1,867).
- **Miss gate, not met on both samples:**
  - **New 100:** 58 misses (48 yes, 10 undecidable) in 6 repositories.
    - 44 are in one repository whose GitHub archive export-ignores its source and lockfile, so the split read a partial tree as complete. That is a gap in the measurement's source acquisition.
    - 11 come from tools a command reaches indirectly (webpack → webpack-cli → webpack-dev-server, a `.ts` config through ts-node).
    - 1 is Umi's `config/config.ts`, which is not in P2's list.
  - Original 100: 11 misses in 4 repositories (the rerun's verdicts).
- **Left for the owner:** a definition change to bring the count down (no implementation fix can: the count comes from section 2's own rules). Also, the open reading of indirect tool hand-offs, and reading sources from a checkout or detecting export-ignore instead of from archives.
