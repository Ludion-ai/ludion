# 2026-10-31 — Impact Classes: takeover only when code running is the direct result of the mechanism

**Decided 2026-10-31** by the owner's Claude chat (ludion-ops#1 comment 6541666295, 18:24 JST), answering the three questions of PR #236's LMR1e-2 report (lane LMR1f). It changes the sets of docs/decisions/2026-10-31-impact-classes-every-cwe-widened.md and adds one sentence to point 6 (the rule for sets) of docs/decisions/2026-10-31-impact-classes-conditions-and-sets.md. Both records stay as written, with a line pointing here; this record says what replaces them. Written and committed before the code was changed and before anything was counted with it.

## Why

LMR1e-2 counted "a written file the application later runs" as takeover. So path traversal (22 to 40), 59, 73, 276, 552 and 732, and the sets of SQL injection (89, 943), 1321 and 15, got takeover. takeover's condition is C:H and I:H, and a CVSS vector's C and I do not say whether code ran: an SQL injection that reads and changes all the data is also C:H/I:H. So every C:H/I:H record of these CWEs became takeover with no code running. The 489 records that went from steal to takeover in LMR1e-2 are read as that shape (the chat's guess; the records were not checked one by one). Takeover (乗っ取り) is the word that weighs most with a user. A strong word without a basis goes against the owner's "strict: this is the brand's credibility" (「厳格に、ここはブランド信用に関わる」).

## The chat's words (6541666295, kept short)

- (1) 「takeover が CWE の集まりに入るのは、攻撃者のコードや命令が動くことが、その仕組みの直接の結果のときだけ。」「入らない：もう一段の手順を経てコードが動くもの。書いたファイルが後で動かされる、ガジェットの連鎖、データベースの機能で命令を動かす、など。」「理由：ベクトルは、その一段が起きたかを言わない。だから『乗っ取り』とは書けない。『改ざん』なら、記録が言っている。」
- (2) 「上の (1) で数え直す。そのうえで、強い側へ動いた記録を一件ずつ並べる（もう定義にある）。takeover へ動いたものは、別に件数を出す。」
- (3) 「XSS・認可・認証に disrupt、601 に steal を足すのは、原則のとおり。どれも弱い側の分類なので、ベクトルが強い分類を許すときは、選ばれない。」

## Decided

1. **The rule for sets** (point 6 of the conditions record) gets one sentence: **"takeover is in a CWE's set only when the attacker's code or commands running is the direct result of the mechanism. Every other class the mechanism can give goes into the set."** (「takeover は、コードが動くことがその仕組みの直接の結果のときだけ。ほかの分類は、その仕組みで得られうるものを全部入れる」.) A mechanism whose code runs only after one more step (a written file the application later runs, a chain of gadgets, a database feature that runs commands) does not give takeover: the vector does not say whether that step happened. This replaces the every-cwe-widened record's sentence "writing a file the application later runs counts".
2. **takeover stays** in the sets of these CWEs, whose mechanism runs the attacker's code or commands by itself:
   - code and command injection: 77, 78, 94, 95, 96, 98;
   - deserialization: 502;
   - code downloaded without an integrity check: 494;
   - functionality included from an untrusted sphere: 829;
   - expression language and template injection: 917, 1336;
   - a dangerous file upload processed in its environment: 434;
   - hidden functionality: 912. A hijack's backdoor is sometimes recorded under this CWE (the limit in point 5 of the conditions record).

   Their sets do not change: 434 and 912 {T, I, S, A, D}; the others {T, S, A, D}.
3. **takeover leaves** these sets. Every other class stays.

   | CWE | Was | Now | Why takeover goes |
   |---|---|---|---|
   | 22 to 40 | {T, S, A, D} | {S, A, D} | Path traversal reads, writes or deletes a file; code runs only if the application later runs a written file. |
   | 59 | {T, S, A, D} | {S, A, D} | Link following: as path traversal. |
   | 73 | {T, S, A, D} | {S, A, D} | External control of a file name or path: as path traversal. |
   | 276 | {T, S, A, D} | {S, A, D} | Default permissions let installed files be modified; a modified file runs only when something later runs it. |
   | 552 | {T, S, A, D} | {S, A, D} | Files accessible to external parties: read, changed or removed; replaced code runs only when something later runs it. |
   | 732 | {T, S, A, D} | {S, A, D} | Permissions on a critical resource: as 276. |
   | 89 | {T, I, S, A, D} | {I, S, A, D} | SQL injection reads and changes data, bypasses a login query and drops tables; commands run only through a database feature. |
   | 943 | {T, I, S, A, D} | {I, S, A, D} | Data query logic: as 89; a query language that evaluates code does so as a further step. |
   | 1321 | {T, I, S, A, D} | {I, S, A, D} | Prototype pollution changes object behaviour; code runs only through a chain of gadgets. |
   | 15 | {T, I, S, A, D} | {I, S, A, D} | External control of a setting turns off a check, exposes or changes data, or stops the product; a command it names runs only when the product later uses it. |

   With this, 22 to 40, 59, 73, 276, 552 and 732 have the set of 611 and 918, and 89, 943, 1321 and 15 the set of XSS, authorization and authentication. No CWE enters or leaves the table, the decided-unclassified list or the trap list. The other rows of the every-cwe-widened record do not change.
4. **Kept as decided** (answer (3)): disrupt for XSS, authorization and authentication, and steal for 601. They are weaker classes, so a vector that allows a stronger class of the set never picks them.
5. **The design rule and its two checks** (point 1 of the conditions record, as corrected in LMR1e) do not change. The 31 sets and 80 pairs at the step that chooses stay as they are. How many sets and pairs the shipped table's row unions form is found by the test and reported with the count; every pair must still have a vector that gives it.

## Measured with it (defined before counting)

On the same two zips (sha256 checked), in Docker with no network, every record is classified by three impact.ts files:
- **LMR1d**: the impact.ts of f25d51b, the "before" of LMR1e-2's count;
- **LMR1e-2**: the impact.ts of 42e30b6, PR #236's head before this lane;
- **after**: the new one.

For each, among records that are not MAL-:
- the share classified, per ecosystem and together;
- the count of each class;
- unclassified by reason: the vector rules out every class; no vector and two or more classes; no CWE in the table; no CWE; an unreadable vector;
- for each set with one class, how many records the vector made unclassified.

The changes LMR1e-2 → after and LMR1d → after, each by direction (from → to). Every record that moved to a stronger class, one by one, for both: LMR1d → after (the list the every-cwe-widened record defined) and LMR1e-2 → after. **The records that moved to takeover are counted apart**, for both, by the class they came from.

## Undo

A later decision, with its own record.
