## 2026-10-28 (cycle 2) — CLAUDE.md's built and not-built list catches up

The owner chose D1. CLAUDE.md's "Not built yet … Built" paragraph now matches main; nothing else in CLAUDE.md changes (rules, procedures, other sections). Details stay in docs/design.md and this file; the paragraph only points at them.

It adds as built:

- rules 1 and 2;
- the same-release exception, in its strict form as implemented;
- Packagist's advisories in Composer planning;
- that the judge v0 is the parts of gates 1, 2 and 4 the paragraph lists, and the table's wait.

It adds as not built:

- gate 2's inspection for obfuscated code and new network or process calls, which nothing does;
- gate 3 in `ludion judge`;
- a project's own stricter wait;
- automatic merge.

Its closing sentence now says the backtest gate is not met: backtest v4 still misses one malicious version, and unknowns remain.

Chosen here:

- **"ゲート1は未合格" is read as the backtest gate.** That is the first of the design's measured gates ("ゲートで測るもの" 1), not the first of the four gates. CLAUDE.md says "the backtest gate", so the two are not confused. The sentence replaces the one that named only the first backtest.
- **One fact already in the list had become false and is corrected.** "patch receipts list them, nothing judges them" stopped being true when rules 1 and 2 began to check every version a `ludion patch` candidate adds. The list now says the other checks over the lockfile diff are not built outside the judge.
- **The exception's publisher condition is stated narrowly.** CLAUDE.md says trusted publishing's shared user never matches, not that every shared CI user fails to match: a shared account with a plain lowercase name still counts as an account ("After #151's post-merge review").
- **The judge workflow on this repository (#156) is not listed.** It is not merged, and it is a use of the judge, not a product feature.

The first review of #158 asked for changes (https://github.com/Ludion-ai/ludion/pull/158#issuecomment-6464728362). Its two blocking findings were sentences stronger than the code:

- "The judge v0 is gates 1, 2 and 4" also covered gate 2's code inspection, which is built nowhere. The paragraph now lists that inspection as not built. It calls the judge v0 the parts of gates 1, 2 and 4 that it lists, and the wait.
- "Published before T" did not hold for Composer, whose release date comes from Packagist and is set by the author, so a backdated release passes. The paragraph now says so.

From the review's non-blocking findings:

- rules 1 and 2 check every version a change adds besides the fix itself;
- the exception lets a version past rule 1 only;
- in `ludion patch`, the advisory re-scan also checks the lockfile diff.

The rest stays in this file and is not repeated in CLAUDE.md: rule 2's 168h threshold in `ludion patch` (patch has no wait), the unverified Sigstore signature, and the provenance branch's lack of a time limit.

The second review (fresh context) asked for changes too (https://github.com/Ludion-ai/ludion/pull/158#issuecomment-6464944682). Its blocking finding: "the waits" claimed a project's own stricter wait, which `judge()` accepts as `projectWait` but no caller passes and nothing reads from a project. The paragraph now lists that wait as not built and says the judge has the table's waits.

From its non-blocking findings:

- the not-built clause names what `ludion patch` does check over the lockfile diff: rules 1 and 2, its OSV re-scan (which also finds MAL- records, so MAL- is no longer listed as missing there), and its removal and major-version checks;
- this entry calls 168h rule 2's threshold, since patch has no wait.

Left as it is: "T, the fix's publish time" does not add that, with no fix, T comes from the changed direct dependencies. "Moving dependencies are capped at the fix's publish time" says so.

The entries stay where they are, beside the earlier CLAUDE.md entries. Appending at the end of these files would collide with the other open PRs that append there, and every conflict on a protected PR costs a new review.

