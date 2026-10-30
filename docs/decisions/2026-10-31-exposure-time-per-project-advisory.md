# 2026-10-31 — Exposure time is counted per (project, advisory)

**Decided 2026-10-31 02:52 JST** by the owner's Claude chat (ludion-ops#1 comment 6529705640, "監査の指摘2"), which accepted finding 2 of the second hourly first-principles audit (comment 6529106910). Under comment 6525272283 ("毎時の監査"), audit findings that touch the goal, the scope, a gate, a wait or a rule are judged by the chat. Whether the owner has seen this decision is not on the board (不明).

## Why

Exposure time is the time a project carried a hole it could have fixed and had not. So it is counted per (project, advisory), not per version. Today's `fix_published_at` is the latest publish time among a fix's planned versions (docs/status.md), so each new advisory resets the clock of the older ones. The difference appears only when an older fix was not applied, through a wait, a failure or a stop, so the measure leans toward hiding exactly those misses (the audit). In the audit's example, a receipt's single value was 5,082 hours, while per advisory the median was 6,765 hours and a HIGH command injection had been fixable for 49,871 hours by the time it was detected (one trial receipt).

## Decided

1. **Unit:** (project, advisory).
2. **Start:** the publish time of the earliest usable version, within the same major, that fixes that advisory (`first_fixed_published_at`). Deprecated, withdrawn and MAL- versions are skipped.
3. **End:** the time that advisory left the project's configuration: the PR's merge time, or the time of a later detection that found it gone.
4. **Main quantity:** the median over this unit. Today's `fix_published_at` (when the whole fix could be applied) stays, as a separate field.
5. **What is sent does not change:** names and versions, to OSV and the registries.

Added 2026-10-31 03:54 JST by the chat (ludion-ops#1 comment 6531046171, 2, answering the audit in comment 6530612087):

6. **Denominator:** every (project, advisory) that started within the measured window, including the pairs for which no PR could be opened.
7. **Open pairs are right-censored.** The median is computed with Kaplan–Meier. If the Kaplan–Meier estimate does not reach 0.5 by the end of follow-up, it is written as "median > t", where t is the longest follow-up time. (6531046171 wrote "if fewer than half of the pairs have ended". With censoring, the estimate can fall below 0.5 even then, so the audit corrected the condition to this one, and comment 6533365853, 6 took it in.)
8. **A pair with no fix in the same major** starts from the earliest usable fix in any major, skipping versions as item 2 does, and is in the same denominator. It is also counted separately, as out of scope (範囲の外).

Added 2026-10-31 06:00 JST by the chat (ludion-ops#1 comment 6533365853, 6), which took in findings N1 to N4 of the review of this PR (comment 6532712835 on PR #230) and the audit's own correction of the "median > t" condition, as corrections to the definition before measuring:

9. **The window** is fixed before counting. A pair already open when the window starts is either entered into Kaplan–Meier with delayed entry (left truncation) or always shown as a separate row of the same table; which of the two is fixed with the window. Choosing the window's start later cannot then drop the longest exposures. With delayed entry, those pairs are in the Kaplan–Meier denominator too, so it is wider than item 6's; with the separate row, item 6's denominator stays as it is and the row is shown beside it.
10. **Censoring time:** an open pair is censored at the last detection, within the window, that still found the advisory in the project's configuration.
11. **When a version is judged usable** (items 2 and 8): as of the pair's end, or its censoring time while it is open. A version deprecated, withdrawn or given a MAL- record after that does not move the start of a pair that has ended, so a later deprecation does not shorten an ended pair's exposure. While a pair is open its censoring time moves on, so its start can still move later. The npm registry keeps no time for a deprecation (`deprecated` is only a string), so the state "as of" a time cannot be decided afterwards unless it was read and recorded then; OSV's MAL- and withdrawn records have times. One of the following is fixed before counting:
    - usability is read and recorded at the detection that sets the pair's end or censoring time, and a version with no such record is shown separately as 不明; or
    - usability changes with time: from any time t at which a usable fixed version exists, the pair is exposed. A MAL- version is unusable from the start; a deprecated or withdrawn version is unusable from that time.
12. **Which pairs exist** is decided by matching the advisory's affected range against the versions in the lockfile or the image (OSV), not by Ludion's own judgement. Pairs that Ludion's gate 1 finds not to apply are counted separately, and stay in the denominator. A pair is decided by OSV's answer at the first detection that found it; a later change in OSV does not remove it, and pairs that OSV later changed are shown separately.

Added 2026-10-31 06:59 JST by the chat (ludion-ops#1 comment 6534448385, 2, after the audit in comment 6533867423, 1):

13. **The scheduled slots that did not fire are part of the result:** with exposure time, each repository's q (the share of slots that fired) for the window is reported.

## When it takes effect

Fixed now, before exposure time is measured (the exposure-time end is not built; docs/status.md). CLAUDE.md's Product names median exposure time as a measure; changing its wording for this unit is LC0, a protected PR the owner merges (comment 6529705640, "監査の指摘2"; 7).

## Undo

A later decision, with its own record.
