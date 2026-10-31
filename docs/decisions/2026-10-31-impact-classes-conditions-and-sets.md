# 2026-10-31 — Impact Classes: a stronger class's condition no longer follows from a weaker one's, and each CWE's set holds every class its mechanism can give

**Decided 2026-10-31** by the owner's Claude chat (ludion-ops#1 comment 6539943852 (a), 15:11 JST, and comment 6540209072 items 1 and 4, 15:42 JST, which replace part of (a)), for PR #236 (lane LMR1d). It changes docs/decisions/2026-10-31-impact-classes-cvss-vector.md (the conditions, point 5 and the sets) and docs/decisions/2026-10-31-impact-classes-trap-published-record.md (which CWEs make a trap). Those records stay as written; this one says what replaces them. Written and committed before the code was changed and before anything was counted with it.

## Why

The conditions of the vector record were nested: every vector consistent with steal or alter was also consistent with impersonate and takeover. So a vector could never move a record down from takeover or impersonate. LMR1c's count bears this out: no record went from impersonate to steal.

## Decided

1. **The design rule** (comment 6540209072, item 1, which replaces the pairwise rule of 6539943852 (a)). For every set of classes and every class W in it, at least one vector is consistent with W and with no class of the set that is stronger than W. The tests check it in two ways, each with every one of the 27 CVSS 3 vectors (C, I and A each N, L or H) and of the 729 CVSS 4 vectors (VC, VI, VA, SC, SI and SA each N, L or H):
   - **Every set, at the step that chooses.** `chooseClass` is the step `classify()` runs after it has taken the union of the CWEs' sets: it keeps the classes consistent with the vectors (CONSISTENT) and takes the strongest (IMPACT_ORDER). It is given each of the 31 non-empty sets of the five table classes directly. For each of the 80 pairs of a set and a class in it, a CVSS 3 vector and a CVSS 4 vector must give that class.
   - **Every set the shipped table can form, through the real `classify()` with real CWEs.** The sets a record's CWEs can form are the unions of the table's rows (point 7): 13 sets and 33 pairs. Each pair must be given by some vector. A row added later whose unions include a set with no such vector fails this test.

   *Corrected in LMR1e* (ludion-ops#1 comment 6540622832, point 2). This point first said that each of the 31 sets is built from CWEs that each allow one class. The table of point 7 cannot do that: only steal, alter and disrupt keep CWEs with one class.
2. **The conditions.** Confidentiality, integrity and availability are "not N" as before (CVSS 4: the vulnerable or the subsequent system).
   - takeover: CVSS 3 C:H and I:H; CVSS 4 VC:H and VI:H, or SC:H and SI:H.
   - impersonate: confidentiality and integrity both not N.
   - steal: confidentiality not N.
   - alter: integrity not N.
   - disrupt: availability not N.
3. **What was not decided before.**
   - When no class of the set is consistent with the vectors, the record is unclassified ("the vector rules out every class its CWEs allow").
   - A record with two or more CWEs takes the union of their sets.
   - With CVSS 3 and 4 vectors both, only classes consistent with both are kept.
   - **With no vector and a union of two or more classes, the record is unclassified.** This replaces point 5 of the vector record (the strongest decided class), which had classified 12 records.
4. **trap** is a MAL- id, a MAL- alias, or one of **CWE-506 to 512**, the malicious-code family:
   - 506 embedded malicious code;
   - 507 Trojan horse;
   - 508 and 509 malicious code (non-replicating, replicating);
   - 510 trapdoor;
   - 511 logic or time bomb;
   - 512 spyware.

   The vector is still not read for a trap. GHSA-428f-mh7w-6w2x (CWE-509) is therefore trap.
5. **CWE-912** (hidden functionality) is **not** trap: it is also given to features a legitimate product forgot to remove, so it does not say the version itself is malicious. It is in the table with the takeover set below. **The limit:** a hijack advisory that lists only CWE-912 and 829, like ua-parser-js's withdrawn duplicate GHSA-236c-vhj4-gfxg, is "takeover", not "trap". In the exports counted for #236, 8 records that are not trap list CWE-912: GHSA-236c-vhj4-gfxg, GHSA-457r-cqc8-9vj9, GHSA-8gr3-2gjw-jj7g, GHSA-8jh9-wqpf-q52c, GHSA-9wfr-w7mm-pc7f, GHSA-j9cw-5cpj-9qj5, GHSA-pg98-6v7f-2xfv and GHSA-qq6h-5g6j-q3cm. ua-parser-js's own malware advisory GHSA-pjwm-rvh2-c87w lists CWE-506 and stays trap.
6. **The rule for sets** (comment 6540209072, item 4). A CWE's set holds every class an attacker can gain through its mechanism; the record's vector says which. A set has one class only when the mechanism truly gives only one.
7. **The sets.** No other CWE enters or leaves the table.

   | Set | CWEs |
   |---|---|
   | {takeover, steal, alter, disrupt} | code and command injection and the other ways to run code: 77, 78, 94, 95, 96, 98, 434, 494, 502, 829, 917, 1336, and 912 |
   | {impersonate, steal, alter} | authorization, access control and privileges (266, 269, 284, 285, 425, 639, 862, 863); XSS and its variants (79, 80, 83 to 87); authentication and its bypasses (287 to 290, 294, 302, 303, 305 to 307); sessions (384, 613); passwords (620, 640); credentials (798, 1390 to 1393) |
   | {impersonate, alter} | CSRF (352): the attacker makes the user act but cannot read the answer; open redirect (601) |
   | {steal, alter} | path traversal and its variants (22 to 40), 89, 552, 943, and 59, 73, 276, 732 (taken out of the decided-unclassified list) |
   | {steal} | as before: 90, 125 to 127, 200 to 204, 208, 209, 212 to 215, 226, 256, 257, 311, 312, 319, 359, 497, 522, 524 to 526, 532, 538, 548, 598, 611, 643, 652, 918 |
   | {alter} | as before: 15, 91, 471, 472, 642, 915, 1321 |
   | {disrupt} | as before: 400, 401, 405, 407, 409, 674, 770, 776, 789, 834, 835, 1050, 1333 |

   For the takeover row, comment 6540209072 names "code and command injection (77, 78, 94 and so on) and 912". By the rule of point 6, every CWE that was takeover takes the same set: an upload, a download without an integrity check, deserialization or an inclusion can also give only a read, a change or a crash, which a C:L/I:L/A:L vector says. The {steal}, {alter} and {disrupt} rows were not named by the chat and are kept as they were.

## Measured with it (defined before counting)

On the same two zips as LMR1, LMR1b and LMR1c (sha256 checked in the volume before the run), in Docker with no network, every record is classified three times:
- by the impact.ts of 0129ba8 (LMR1c);
- by the new code with **the sets before widening**, which is comment 6539943852 (a) alone: the LMR1c sets, with 912 → {takeover}, 79 → {impersonate, steal, alter}, and 59, 73, 276, 732 → {steal, alter};
- by the new code with **the sets after widening** (the table above, which the code ships).

For the two new runs:
- the share classified among records that are not MAL-, per ecosystem and together;
- the count of each old class → new class against LMR1c, and between the two new runs;
- unclassified by reason: the vector rules out every class; no vector and two or more classes; no CWE in the table; no CWE; an unreadable vector;
- for each set with one class, how many records the vector made unclassified;
- the share of records that are not MAL- with no CVSS vector;
- every record that moved to a stronger class, one by one.

## Undo

A later decision, with its own record.
