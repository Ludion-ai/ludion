# 2026-10-31 — Impact Classes: every CWE in the table gets every class its mechanism can give

**Decided 2026-10-31** by the owner's Claude chat (ludion-ops#1 comment 6540818608, point 2, 16:50 JST), answering the three questions of PR #236's LMR1d report (lane LMR1e-2). It changes point 7 (the sets) of docs/decisions/2026-10-31-impact-classes-conditions-and-sets.md, which stays as written; this record says what replaces it. The conditions, the design rule and its two checks (that record's point 1, as corrected in LMR1e) and the rule for sets (its point 6) do not change. Written and committed before the code was changed and before anything was counted with it.

## The chat's words (6540818608, point 2, kept short)

- (a) 434 → {takeover, impersonate, steal, alter, disrupt}: an uploaded file can run code, enter the users' pages or overwrite files. 494, 502, 829 → the code-injection set {takeover, steal, alter, disrupt}.
- (b) The rule for sets applies to **every CWE in the table**: from the CWE's definition, every class its mechanism can give goes into its set, with a one-line reason per CWE here. Examples: 918 (SSRF) → {steal, alter, disrupt}, 611 (XXE) → {steal, alter, disrupt}. **When in doubt, the wider set**; the vector decides which. In exchange, more records with no vector are unclassified: "do not know" is said honestly rather than guessed strong. The counts are given by reason.
- (c) It is fine that no real CWE allows only takeover or only impersonate. The 31 sets and 80 pairs are checked at the step that chooses; separately, the real `classify()` runs every set the shipped table's CWEs can form (point 1 of the conditions record, as corrected in LMR1e, already says this).

## The sets

T takeover, I impersonate, S steal, A alter, D disrupt. A set lists every class the CWE's mechanism (its CWE 5.0 definition, docs/bench/2026-10-31-lmr1-impact-classes/logs/cwe-definitions.log) can give an attacker. A class is left out only when the mechanism cannot give it. Takeover means running the attacker's own code or commands. It is in a set only when the mechanism can do that by itself (writing a file the application later runs counts; logging in as an administrator does not).

### {T, I, S, A, D}

| CWE | Why |
|---|---|
| 15 | External control of a setting: a setting can turn off a check, expose or change data, stop the product, or name a command it runs. |
| 89 | SQL injection: reads and changes data, bypasses a login query, drops tables, and can run commands or write files through the database. |
| 434 | Dangerous upload processed in the environment: the chat's answer (a). |
| 912 | Hidden functionality: undocumented functionality can be anything, a backdoor login or a command channel among them. |
| 943 | Data query logic (SQL, NoSQL, LDAP, XPath…): as 89; some query languages evaluate code. |
| 1321 | Prototype pollution: changes object behaviour, which reaches code execution, a login check or a crash through gadgets, and can expose data. |

### {T, S, A, D}

| CWE | Why |
|---|---|
| 77, 78 | Command and OS command injection: runs commands, and through them reads, changes or stops. |
| 94, 95, 96 | Code generation, eval and static code injection: runs code. |
| 98 | PHP include filename: includes and runs a file, or only reads it. |
| 494 | Code downloaded without an integrity check: the chat's answer (a). |
| 502 | Deserialization of untrusted data: the chat's answer (a). |
| 829 | Functionality included from an untrusted sphere: the chat's answer (a). |
| 917, 1336 | Expression language and template injection: evaluates expressions, which run code. |
| 22 to 40 | Path traversal and its variants: reads, writes or deletes files outside the directory; a written file the application runs gives code execution. |
| 59 | Link following: the file reached may be read, written or deleted, as for path traversal. |
| 73 | External control of a file name or path: as for path traversal. |
| 276 | Default permissions let anyone modify installed files: a modified executable or script runs; files can be changed or removed. |
| 552 | Files or directories accessible to external parties: read, and if writable changed, removed or replaced with code. |
| 732 | Permissions on a critical resource let it be read or modified: as 276 when the resource is code or configuration. |

### {I, S, A, D}

| CWE | Why |
|---|---|
| 79, 80, 83 to 87 | XSS and its variants: script runs in the user's page, acting as the user, reading and changing what the page holds, or making it unusable. |
| 266, 269 | Privileges assigned or managed wrongly: an unintended sphere of control, so acting with more rights, reading, changing or removing. |
| 284, 285, 425, 639, 862, 863 | Access control and authorization: an unauthorized access to a resource or action, which may read, change, remove or act as another user. |
| 287 to 290, 294, 302, 303, 305 | Authentication and its bypasses: logging in as someone, then doing what they can. |
| 306 | Missing authentication for a critical function or one that "consumes a significant amount of resources": as above, and stopping. |
| 307 | Excessive authentication attempts: guessing a login, and locking accounts out. |
| 384, 613 | Session fixation and expiry: taking over a session, then doing what its user can. |
| 620, 640 | Unverified password change, weak recovery: taking over an account. |
| 798, 1390, 1391, 1392, 1393 | Hard-coded, weak and default credentials: logging in with them. |

### Other sets

| Set | CWE | Why |
|---|---|---|
| {I, A, D} | 352 | CSRF: the user is made to send a request that changes or removes something; the attacker cannot read the answer. |
| {I, S, A} | 601 | Open redirect: sends users to a page that acts as the site, or leaks a token in the redirect (OAuth), so it can also read. |
| {I, S, A} | 90 | LDAP query injection: bypasses a login filter, reads entries, and changes them where the query feeds an update. |
| {I, S, A} | 91 | XML injection: changes the XML's content or commands, which can change data, bypass a signed assertion or read. |
| {I, S, A} | 311, 319 | Missing encryption, cleartext transmission: read, changed in transit, and credentials taken. |
| {I, S, A} | 642 | Critical state data accessible to unauthorized actors: read or changed, including who the user is. |
| {I, S} | 643, 652 | XPath and XQuery "used to retrieve data": read, and bypass a login query. |
| {I, S} | 256, 257, 522 | Unprotected passwords and credentials: read, then used to log in. |
| {I, S} | 312 | Cleartext storage of sensitive information: read, credentials among it. |
| {I, A} | 471, 472, 915 | Assumed-immutable data, hidden parameters, object attributes: changed, a role or an identity among them. |
| {S, A, D} | 611 | XXE: the chat's example; reads local files, sends requests that change, expands entities until the product stops. |
| {S, A, D} | 918 | SSRF: the chat's example; reads internal responses, sends requests that change or stop internal services. |
| {S, D} | 125, 126, 127 | Out-of-bounds read: reads memory, or crashes. |
| {S} | 200 to 204, 208, 209, 212 to 215, 226, 359, 497, 524 to 526, 532, 538, 548, 598 | Exposure of information through a response, a timing, an error, a cache, a log, a listing or a query string: the mechanism only lets it be read. |
| {D} | 400, 401, 405, 407, 409, 674, 770, 776, 789, 834, 835, 1050, 1333 | Resource consumption, recursion, loops, ReDoS: the mechanism only slows or stops. |

No CWE enters or leaves the table, the decided-unclassified list or the trap list.

## Measured with it (defined before counting)

On the same two zips (sha256 checked), in Docker with no network, every record is classified by the impact.ts of f25d51b (before) and by the new one (after):
- the share classified among records that are not MAL-, per ecosystem and together;
- the count of each class before and after;
- unclassified by reason: the vector rules out every class; no vector and two or more classes; no CWE in the table; no CWE; an unreadable vector;
- for each set with one class, how many records the vector made unclassified;
- the changes before → after by direction, and every record that moved to a stronger class, one by one.

## Undo

A later decision, with its own record.
