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
7. **Open pairs are right-censored.** The median is computed with Kaplan–Meier; if fewer than half of the pairs have ended, it is written as "median > t".
8. **A pair with no fix in the same major** starts from the earliest fix in any major and is in the same denominator. It is also counted separately, as out of scope (範囲の外).

Not on the board (不明), to be fixed in the definition before measuring: the window and how pairs already open when it starts are handled; the time at which an open pair is censored; the time at which a version is judged usable, and whether item 8's earliest fix skips unusable versions as item 2 does.

## When it takes effect

Fixed now, before exposure time is measured (the exposure-time end is not built; docs/status.md). CLAUDE.md's Product names median exposure time as a measure; changing its wording for this unit is LC0, a protected PR the owner merges (comment 6529705640, "監査の指摘2"; 7).

## Undo

A later decision, with its own record.
