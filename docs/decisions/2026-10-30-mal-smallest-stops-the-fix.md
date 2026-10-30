# 2026-10-30 — A smallest fixed version with an OSV MAL- record stops the fix

**Owner decision, 2026-10-30 17:54 JST**, to the owner's Claude chat, in the owner's words 「1.OK」 (point 1 of three put to the owner): 「最小の修正版が OSV の MAL- 記録で飛ばされたときは、その修正を止める。次の版は選ばない。」 (when the smallest fixed version is passed over because of an OSV MAL- record, that fix stops; no next version is chosen.)

This overrides, for that case only, docs/decisions/2026-10-30-next-fix-same-publisher.md, which is left as it was: there, a version taken in place of the smallest goes on when it comes from the same publisher account or the same provenance repository and workflow. When the smallest has a MAL- record, no later version is looked at, so that comparison is never made.

## Why

If the fixed version itself is malware, the source it comes from is being taken over at that moment. The publisher check compares the next version's publisher with the smallest's, and here the smallest's publisher is the malware's publisher, so a match says nothing in the next version's favour (the cloud review of #213, https://github.com/Ludion-ai/ludion/pull/213#issuecomment-6515878521, point 2). It rarely happens, so stopping costs little.

## Decided

On `ludion patch`, npm only, in next-fix.ts. Nothing else changes: no gate's numbers, no row of the wait table, and not the case where the smallest is used.

1. **When.** OSV names the smallest fixed version in a MAL- record that it does not mark withdrawn (the same reading as before: a record counts when its id starts with `MAL-`). This holds whatever else names it or is true of it: another OSV record (an advisory) beside the MAL- record, a deprecation, or the registry no longer listing it. So OSV is now asked about the smallest even when it is deprecated or no longer listed; before, a deprecated or unlisted smallest was passed over without asking OSV, so a MAL- record on it was not seen. Only the package's name and the version are sent, as before, and, back to OSV, the ids of the records it returned (each is read for its withdrawal). If that query or a record read fails, the lookup fails as any other: the smallest stays, and the judge checks it as before, so a deprecated smallest whose later versions could be read no longer gives way to the next version when OSV cannot answer about the smallest itself.
2. **What happens.** No later version is looked at, and OSV is not asked about any. That fix stops at gate 2, before any build or test: it is not validated, gets no branch, and fails; the run's other fixes go on. The smallest is not used instead, as it is malware.
3. **What is recorded.** The fix's receipt entry `version_choice` has `chosen: null`, the smallest in `skipped` with every reason found (the MAL- ids first, then any other records, a deprecation or its absence from the registry), the MAL- ids in `malicious`, and a note that says the fix stops because the smallest is in OSV's malicious-package records, citing this record. The fix's `reason` is "Gate 2 stops this fix: " and that note. No `publisher_check` is made. When one fix has two smallest fixed versions of the package (two installed copies), the first stop, this one or a publisher stop, ends the lookups for that fix: its reason is that stop's note, nothing more is asked about the package, and the fix's `changes` keep every smallest. This last rule, for a publisher stop as for this one, is a detail decided in this lane (CLAUDE.md, Engineering: details can be decided autonomously), not the owner's sentence: since #213, a fix stopped by the publisher check on one copy could still look up the other copy and carry that copy's next version in `changes`.
4. **Unchanged.** A smallest passed over for any other reason (a deprecation, no longer listed, an OSV record that is not MAL-) goes on to the next smallest version and the publisher check exactly as before. A later version with a MAL- record is passed over as before, and the search goes on.

## Undo

A later decision of the owner's, with its own record. Removing the stop restores next-fix-same-publisher's behaviour for this case: the next version is taken when its publisher or provenance matches the malware's.
