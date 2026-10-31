# 2026-10-31 — Impact Classes: each CWE allows a set of classes, and the record's CVSS vector chooses among them

**Decided 2026-10-31** by the owner's Claude chat (ludion-ops#1 comment 6539200199, point 3), for PR #236 (lane LMR1c). It changes how docs/decisions/2026-10-31-impact-classes.md (point 2 and the CWE table's rule, point 5) gives a record its class; that record and docs/decisions/2026-10-31-impact-classes-trap-published-record.md stay as written, and this record says what replaces the part they decided about the CWE table. Written and committed before the code was changed and before anything was counted with it.

## The chat's words (6539200199, point 3, kept short)

- 「頭脳は、例として 22・89 を steal、862 を impersonate に固定させた。でも、22（パス・トラバーサル）と 89（SQL インジェクション）は、読みも書きもありうる。判断記録が CWE-59・73 を doubtful にした理由と、同じ理由が当てはまる。」
- 「CWE ごとに、ありうる分類の集まりを持つ。例：22 → {steal, alter}、89 → {steal, alter}、862 → {impersonate, steal, alter}、78 → {takeover}。」
- 「記録に CVSS のベクトルがあれば、ベクトルと矛盾しない分類だけを残し、その中で一番強いものにする。」steal は C≠N、alter は I≠N、disrupt は A≠N、impersonate は C か I が N でない、takeover は C・I・A のどれかが N でない。v4 では、後に続く系（VC・SC など）も見る。
- 「ベクトルが無いときは、集まりが一つのときだけ、その分類にする。二つ以上なら unclassified。」
- 「trap（MAL-、別名の MAL-、CWE-506）は、ベクトルを見ずに trap。」

## Decided

1. **trap** is decided first, as before (a MAL- id, a MAL- alias, CWE-506), and the vector is not read for it.
2. **Each CWE in the table allows a set of classes** (`CWE_CLASSES` in impact.ts). A set has more than one class only where the CWE's definition allows more than one gain; the chat's four examples are kept. The CWEs in the table and in the decided-unclassified list do not change in this record (see "Not changed here"); only their sets do:

   | Set | CWEs | Why |
   |---|---|---|
   | {takeover} | 77, 78, 94, 95, 96, 98, 434, 494, 502, 829, 917, 1336 | The definitions say their own code or commands run (78 is the chat's example). |
   | {impersonate, steal, alter} | 266, 269, 284, 285, 425, 639, 862, 863 | Authorization, access control and privileges: the definitions say an actor gets "access a resource or perform an action" or "an unintended sphere of control", so acting as someone else, reading or changing (862 is the chat's example). |
   | {impersonate} | 79, 80, 83 to 87, 287 to 290, 294, 302, 303, 305 to 307, 352, 384, 601, 613, 620, 640, 798, 1390 to 1393 | XSS, authentication and its bypasses, CSRF, sessions, open redirect, password recovery, hard-coded and weak credentials: the gain is acting as a user. |
   | {steal, alter} | 22 to 40, 89, 552, 943 | Path traversal, SQL injection (the chat's examples), files or directories "accessible" to unauthorized actors, data query logic "intended to access or manipulate data": read or written. |
   | {steal} | 90, 125, 126, 127, 200 to 204, 208, 209, 212 to 215, 226, 256, 257, 311, 312, 319, 359, 497, 522, 524, 525, 526, 532, 538, 548, 598, 611, 643, 652, 918 | LDAP queries, out-of-bounds reads, exposure of information, unprotected credentials and missing encryption, XXE ("embed ... documents into its output"), XPath and XQuery ("used to retrieve data"), SSRF ("retrieves the contents"): the definitions say read. |
   | {alter} | 15, 91, 471, 472, 642, 915, 1321 | Settings, XML, assumed-immutable data, critical state, object attributes, prototypes: the definitions say modified or controlled. |
   | {disrupt} | 400, 401, 405, 407, 409, 674, 770, 776, 789, 834, 835, 1050, 1333 | Resource consumption, recursion, loops, ReDoS. |

3. **The CVSS vectors** are read from the OSV record's `severity` list: an entry whose `type` is `CVSS_V3` with a score starting `CVSS:3.0/` or `CVSS:3.1/`, or `CVSS_V4` with a score starting `CVSS:4.0/`. Other types are not read (the exports measured for #236 have no other type).
   - Only base metrics are read. CVSS 3: C, I and A. CVSS 4: VC, VI and VA (the vulnerable system) and SC, SI and SA (the subsequent systems). Each must appear exactly once with the value N, L or H; an entry of these types that does not is unreadable, and the record is unclassified with the reason, since a vector that cannot be read cannot rule a class out.
   - Confidentiality is not N when C (CVSS 3), or VC or SC (CVSS 4), is not N; integrity likewise from I, VI or SI; availability from A, VA or SA.
   - A class is consistent with a vector when: steal, confidentiality is not N; alter, integrity is not N; disrupt, availability is not N; impersonate, confidentiality or integrity is not N; takeover, any of the three is not N.
   - A record with several vectors (CVSS 3 and 4): a class is kept only when it is consistent with every one of them.
4. **With at least one vector**: the classes allowed by the record's CWEs in the table (all of their sets together) that are consistent with the vectors are kept, and the record takes the strongest of them. When none is consistent, the record is unclassified with the reason (the vector rules out every class its CWEs allow).
5. **With no vector**: a CWE whose set has one class decides that class; a CWE whose set has two or more decides nothing. The record takes the strongest class its CWEs decide, but only when no CWE whose set has two or more allows a stronger class; otherwise it is unclassified. For a record with one CWE in the table this is the chat's rule as written (one class, that class; two or more, unclassified). For a record with several, it keeps point 2 of the first record (the strongest class among its CWEs) wherever the strongest is certain: CWE-78 with CWE-22 is takeover, since nothing in {steal, alter} is stronger; CWE-400 with CWE-22 is unclassified, since CWE-22 may be steal. The count below also gives the number of records this point classifies that would be unclassified if the record's whole set had to be one class.
6. Unchanged: the classes, the strength order, GHSA's severity only (the vector is not used for severity), CWEs outside the table are unclassified, and the record is not wired into a PR body or job summary.

## Measured with it (defined before counting)

On the same two zips as LMR1 and LMR1b (sha256 49a43c99… npm, 4effe961… Packagist; checked in the volume before the run), in Docker with no network, the new impact.ts and the one before it (218a83a, `git show`, its sha256 logged) classify every record:

- The share classified among records that are not MAL-, per ecosystem and together, as plain counts and percentages. These are all the records of the exports, not a sample, so no interval is given.
- The same with withdrawn records (a `withdrawn` field) left out.
- What changed from the old classification to the new: the count for each old class → new class, and, for each CWE, how many of the records that list it changed class, by old → new. Also: records with no vector, with a CVSS 3 vector only, with a CVSS 4 vector only, and with both; records whose CVSS 3 and 4 vectors disagree on whether confidentiality, integrity or availability is N.
- The records whose `summary` or `details` contains "malware" or "malicious" (ASCII, case ignored, a fixed-string search) and that are not trap under the new rule: the count, and each one's id, ecosystem, package names and CWEs. Whether any of them (CWE-912 among them, and ua-parser-js's advisory) should be trap is for the chat; this lane does not decide it.

## Not changed here

- No CWE enters or leaves the table or the decided-unclassified list. CWE-59 and 73 ("the file may be read or written") and 732 ("read or modified") were made doubtful for the reason the chat now gives for 22 and 89; under this record they could be {steal, alter}, and CWE-276 (its definition says "modify") {alter}. That is for the chat; the count lists how many unclassified records name each of them.
- XSS (79 and its variants) stays {impersonate}, as the first record's examples keep it; the chat did not name it.

## Undo

A later decision, with its own record.
