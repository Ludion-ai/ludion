# 2026-10-31 — Impact Classes: Ludion's own classification of what an attacker gains

**Decided 2026-10-31 12:44 JST** by the owner's Claude chat (ludion-ops#1 comment 6538576259), after the owner's words below. It replaces the CWE → plain-sentence table of comment 6538391108 (12:26 JST), which that comment withdrew. The CWE table's content and the doubtful CWEs below are the lane's (LMR1), made by the rule the chat set; they are listed here so they can be reviewed.

**Changed in part the same day** by docs/decisions/2026-10-31-impact-classes-trap-published-record.md (comments 6538877641 and 6538690397): trap also covers a MAL- alias and CWE-506, and a stop in the protection record carries its reason. Point 3 and the CWE-506 row below are kept as first written.

**Changed in part again** by docs/decisions/2026-10-31-impact-classes-cvss-vector.md (comment 6539200199, point 3): each CWE allows a set of classes and the record's CVSS vector chooses among them. Points 2 and 5 below are kept as first written.

**Changed in part three more times**, each record pointing to the next:
- docs/decisions/2026-10-31-impact-classes-conditions-and-sets.md (LMR1d): the conditions; CWE-507 to 512 are trap with 506; CWE-912 and CWE-59, 73, 276 and 732 enter the table.
- docs/decisions/2026-10-31-impact-classes-every-cwe-widened.md (LMR1e-2): every CWE's set holds every class its mechanism can give.
- docs/decisions/2026-10-31-impact-classes-takeover-direct.md (LMR1f): takeover only when code running is the direct result of the mechanism.

So the unclassified list below no longer holds for 506, 912, 59, 73, 276 and 732. The list is kept as first written; `DECIDED_UNCLASSIFIED` and `TRAP_CWES` in impact.ts are the current lists. Pointed out by the review of 42e30b6 (PR #236 comment 6541677765, point 7).

## The owner's words (Claude chat, 2026-10-31)

- 12:25 JST: 「表を作って、どれだけの危険性から守ったのかってのを」
- 12:43 JST: 「生活の言葉に表す必要はない。世界的企業に成長するんだから独自のものでいいよ」

## Why

Ludion shows, in the user's repository, what it protected the project from (the protection record, 守りの記録). A record of fixes says little unless each row says what the hole would have given an attacker. CWE says how a hole works, not what it gives, and has hundreds of entries; so the record uses Ludion's own classes, sorted by what the attacker gains.

## Decided

1. **The classes** (fixed by the chat; not changed by this lane):

   | id | English | 日本語 | What the attacker gains |
   |---|---|---|---|
   | takeover | Takeover | 乗っ取り | Runs their own code or commands where the application runs |
   | impersonate | Impersonation | なりすまし | Acts as a user or the owner; goes past login or permissions |
   | steal | Data theft | 抜き取り | Reads data, files or secrets they must not see |
   | alter | Tampering | 改ざん | Changes data, files or how the application behaves |
   | disrupt | Disruption | 停止 | Slows or stops the application |
   | trap | Trap | 罠 | The version itself is malicious (an OSV MAL- record) |
   | unclassified | Unclassified | 未分類 | None of the above can be decided |

2. **Strength order:** trap > takeover > impersonate > steal > alter > disrupt > unclassified. A record with several CWEs takes the strongest class among them.
3. **trap** is a record whose OSV id starts with `MAL-` (the lane's brief): the id only, not its aliases. This is next-fix.ts's reading of the smallest fixed version (docs/decisions/2026-10-30-mal-smallest-stops-the-fix.md); dependency-patch.ts's reading of a finding also counts a MAL- alias. A record that names a MAL- id only among its aliases is therefore unclassified here, unless its CWEs give it a class. Whether trap should follow the aliases too is for the chat.
4. **Severity** is the OSV record's `database_specific.severity` only (GHSA's CRITICAL, HIGH, MODERATE or LOW); anything else, or none, is unknown. Ludion does not compute a severity from a CVSS vector.
5. **The CWE table** is fixed in code (`packages/cli/src/security/impact.ts`, `CWE_CLASSES`), reviewed with it, and read from `database_specific.cwe_ids`. Nothing is inferred, by an AI or otherwise.
   - **The rule:** a CWE gets the class its own definition states the attacker gains. A CWE's variants follow it when their definitions are the same hole (CWE-23 to CWE-40 are path traversal, like CWE-22).
   - Too broad to say what is gained, or doubtful between classes: unclassified, with the reason (the list below). A CWE is added to the table only when its definition decides it; never to raise the share classified.
   - The chat's examples, kept: 78, 94, 502 → takeover; 79, 352, 601 → impersonate; 89, 22, 918, 611 → steal; 1321 → alter; 400, 1333 → disrupt; 20, 74, 707, 693 → unclassified.
6. **The protection record's table** (`renderRecord`, English or Japanese): date, package, change (old → new version), class, severity, what Ludion did, and the time from the fix's publication to that action. What Ludion did is one of: opened (a PR), stopped, waited (is waiting), fixed (the fix was merged). A summary line above it counts each action. Every number is a count of the rows given or a time between two of their timestamps; no "had it not been fixed" sentence is written. An empty record says it does not mean the dependencies are safe.

## Lane choices inside the rule

- **CWE-284** (Improper Access Control) is a CWE pillar, but its definition is that an unauthorized actor gets access to a resource, so it is impersonate (goes past permissions). The other pillars seen (693, 707) say no gain and stay unclassified.
- **CWE-434** (dangerous file upload) is takeover: its definition is a dangerous file type "automatically processed within its environment".
- **CWE-798** (hard-coded credentials) is impersonate: whoever knows them authenticates. **CWE-256, 257, 522** (passwords or credentials stored or sent unprotected) are steal: the definitions are about reading them.
- **CWE-776** (recursive entity references in DTDs) is disrupt: it is uncontrolled recursion in XML, and CWE-674's definition is recursion "consuming excessive resources".
- **CWE-613** (insufficient session expiration) is deprecated in CWE 5.0 ("Consider CWE-1462"), but GHSA records still name it. It stays impersonate, for its name: an old session that does not expire.
- **CWE-525** (web browser cache) follows CWE-524 (a cache that "can be read by an actor outside of the intended control sphere"): steal.

Every CWE in both lists, with its abstraction, name and description from MITRE's CWE 5.0 (2026-10-28), is in docs/bench/2026-10-31-lmr1-impact-classes/logs/cwe-definitions.log, so each entry can be checked against the text it was decided by. Checking it moved CWE-476 (NULL dereference) from disrupt to doubtful: its definition does not say the application crashes.

## Doubtful or too broad: unclassified (`DECIDED_UNCLASSIFIED`)

| CWE | Why it is not given a class |
|---|---|
| 20, 74, 116, 184, 668, 693, 707, 754, 913, 1188, 1395 | Too broad: input validation, injection in general, encoding, deny lists, wrong sphere, protection failure, neutralization, unusual conditions, dynamic code resources, insecure defaults, a vulnerable dependency. What is gained depends on the case. |
| 506, 912 | Embedded malicious code, hidden functionality. They match trap's meaning, but trap is decided as the OSV MAL- record, which is also what Gate 2 stops on. A GHSA malware advisory with CWE-506 is therefore unclassified. Whether it should be trap is for the chat. |
| 59, 73 | Link following, external control of a file name: the file may be read or written. |
| 88 | Argument injection: changes a command's options; often turned into running commands, but the definition does not say so. |
| 93, 113, 444 | CRLF and header injection, request smuggling: the gain depends on what is injected. |
| 117 | Log neutralization: what an attacker gains from forged log lines is not stated. |
| 119, 120, 122, 190, 416, 787 | Memory corruption: often turned into running code; the definitions say only that memory is written or reused. |
| 248, 476 | Uncaught exception, NULL dereference: often a crash, but the definitions say only that the exception is not caught or the NULL pointer is dereferenced. |
| 276, 732 | Permissions: the resource may be read or modified. |
| 295, 345, 346, 347, 1385 | Certificate, authenticity, origin and signature checks: the gain depends on what the check protects. |
| 326, 327, 328, 330, 338, 916 | Weak cryptography and randomness: the gain depends on what it protects. |
| 362, 367 | Race conditions: the gain depends on the race. |
| 426, 427 | Search paths: the definitions say resources, not code. |
| 436 | Interpretation conflict: no gain stated. |
| 441 | Unintended proxy: what passes through depends on the case (SSRF, CWE-918, is decided as steal). |
| 470 | Unsafe reflection: selects existing code, does not supply it. |
| 749 | Exposed dangerous method: depends on the method. |
| 843 | Type confusion: no gain stated. |
| 942, 1021, 1022 | Permissive cross-domain policy, clickjacking, tabnabbing: the gain depends on the page. |
| 1236 | CSV injection: runs in the user's spreadsheet, not where the application runs. |

A CWE in neither list (for example CWE-1287, improper validation of a specified type) is unclassified because no one has decided it; the measurement (docs/bench/2026-10-31-lmr1-impact-classes) lists the most frequent ones.

## When it takes effect

The code is not yet used by Ludion's PRs or job summaries. Putting the record into the PR body and the job summary is the next lane (LNT's second half, after #215 and #231), comment 6538576259. Counting a row as fixed needs the record of the merge (the end of exposure time), which is not built (docs/status.md).

## Undo

A later decision, with its own record. A change to the CWE table is a change to this record's lists, reviewed in the same PR.
