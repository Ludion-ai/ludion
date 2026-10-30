# 2026-10-30 — Delta v1's first results broke two of its own pre-registered statements

- **What happened.** Two things in PR #216's first results commits (6d9960a, 20810f5) broke what the definitions had fixed before the run. A fresh-context review (PR comment 6517546396) found both.
  1. **The cache statement.** The definitions (section 2), the README and `copycache.sh` said the lane's cache held only JSON answers, "never package files". But `copycache.sh` copied v5's Software Heritage answers, and those include the raw `package.json` text of the versions Software Heritage held for v5 (`swhManifest` caches it through `Archive.get`). The text was inert, stayed inside the volume, and the volume was deleted.
  2. **The miss explanation.** The README explained a miss, @react-native-aria/switch 0.2.5, with counts measured after the result: line length, entropy, a whitespace run, lookups on `global`. Section 6 says a miss's reason is written from the analyzer's facts only. That departure was published without a decision entry and was recorded only after the review flagged it (`docs/decisions/2026-10-30-ld-delta-v1-miss-inspection.md`). The same text also named four file paths of that malicious version, which the lane's brief keeps out of the repository. They remain in the branch's history; a squash merge keeps them out of main.
- **Why.**
  1. The cache statement was written from what this lane's runner caches. Nobody checked what the copied cache already held.
  2. The explanation was written to answer "why did it pass" fully. It was not checked against the definitions' own rule for how a reason may be written, nor against the brief's list of what may be committed.
- **What changed.**
  - The README states the cache exception.
  - The miss has its decision entry.
  - The README names no path of a malicious version.
  - A test now fails if a malicious row in the committed results gains any field beyond those that carry no path, or a changed-code entry beyond capability names and counts.
- **Check:** `tools/backtest/test/delta-v1-results.test.ts` — every malicious row in delta-v1.json has only the fields that carry no path.
- **Rule:** "Make supported scope and failures explicit."
