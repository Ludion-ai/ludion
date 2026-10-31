# 2026-10-31 — Impact Classes: impersonate, like takeover, only when it is the direct result of the mechanism

**Decided 2026-10-31** by the owner's Claude chat (ludion-ops#1 comment 6542470518, point 6 item 3, 20:1x JST), on PR #236's LMR1f report (lane LMR1g). It changes the sets of docs/decisions/2026-10-31-impact-classes-takeover-direct.md and extends that record's sentence for point 6 (the rule for sets) of docs/decisions/2026-10-31-impact-classes-conditions-and-sets.md to impersonate. Those records stay as written; this record says what replaces them. Written and committed before the code was changed and before anything was counted with it.

## Why

LMR1f took takeover out of SQL injection (89, 943), prototype pollution (1321) and external control of a setting (15) and left them {impersonate, steal, alter, disrupt}. Compared with LMR1d, 496 records then went from steal to impersonate (375 of them list CWE-89) and 376 from alter to impersonate (331 list CWE-1321). impersonate's condition is that confidentiality and integrity are both affected. An SQL injection that is C:H/I:H can read and change the data; that does not mean it can act as a user. The vector does not say which. Like takeover (乗っ取り), impersonate (なりすまし) is a strong word.

## The chat's words (6542470518, point 6 item 3, as written)

- 「3（LMR1f。89 と 1321 が impersonate に上がった）：よくない。18:24 の線（6541666295）を、impersonate にも当てる。」
- 「takeover と impersonate は、強い言葉。だから、その仕組みの直接の結果のときだけ、集まりに入れる。」
- 「SQL インジェクションの C:H/I:H は、『データを読めて変えられる』で、『利用者として振る舞える』ではない。ベクトルは、その違いを言わない。」
- 「直す集まり：89・943 → {steal, alter, disrupt}、1321 → {alter, disrupt}、15 → {steal, alter, disrupt}」
- 「impersonate を残すもの：認証・セッション・資格情報・XSS・CSRF・開いたリダイレクト・認可。他人の身元や権限で振る舞うことが、直接の結果だから。」
- 「判断記録の 6 の原則に、『takeover と impersonate は、その仕組みの直接の結果のときだけ』を書く。」

## Decided

1. **The rule for sets** (point 6 of the conditions record, with the sentence of the takeover-direct record's point 1) now reads, for its added sentence: **"takeover and impersonate are in a CWE's set only when they are the direct result of the mechanism: for takeover, the attacker's code or commands running; for impersonate, acting with another person's identity or rights. Every other class the mechanism can give goes into the set."** (「takeover と impersonate は、その仕組みの直接の結果のときだけ」.) A mechanism that reaches either only through one more step (data read or changed that is later used to log in, a chain of gadgets, a setting the product later uses) does not give it: the vector does not say whether that step happened.
2. **The sets that change.**

   | CWE | Was (LMR1f) | Now | Why impersonate goes |
   |---|---|---|---|
   | 89 | {I, S, A, D} | {S, A, D} | SQL injection reads and changes data, and can drop tables. A login query bypassed or a changed account row is a further step; C:H/I:H does not say it happened. |
   | 943 | {I, S, A, D} | {S, A, D} | Data query logic: as 89. |
   | 15 | {I, S, A, D} | {S, A, D} | External control of a setting exposes or changes data, or stops the product. A check it turns off acts for someone only when the product later relies on it. |
   | 1321 | {I, S, A, D} | {A, D} | Prototype pollution changes object behaviour and can crash the product. Reading data, a login check or code running each comes only through a chain of gadgets. |

   With this, 89, 943 and 15 have the set of 22 to 40, 611 and 918. 1321 alone has {alter, disrupt}, a set no CWE had before. No CWE enters or leaves the table, the decided-unclassified list or the trap list.
3. **impersonate stays** where acting with another person's identity or rights is the direct result: authentication and its bypasses, sessions, credentials, XSS, CSRF, open redirect and authorization (the chat's list). Their sets do not change.
4. **Not changed by this record.** The chat named the four CWEs above. The other sets that hold impersonate are kept as they are: 434 and 912 (all five); 90, 91, 311, 319, 642 {I, S, A}; 256, 257, 312, 522, 643, 652 {I, S}; 471, 472, 915 {I, A}. Whether the rule of point 1 takes impersonate out of any of them is for the chat; this lane does not decide it.
5. **The design rule and its two checks** (point 1 of the conditions record, as corrected in LMR1e) do not change. How many sets and pairs the shipped table's rows form is found by the test and reported with the count; every pair must still have a vector that gives it.

## The records of this chain, and edits undone

The first record, docs/decisions/2026-10-31-impact-classes.md, was changed in part by, in order:
- docs/decisions/2026-10-31-impact-classes-trap-published-record.md (LMR1b);
- docs/decisions/2026-10-31-impact-classes-cvss-vector.md (LMR1c);
- docs/decisions/2026-10-31-impact-classes-conditions-and-sets.md (LMR1d): the conditions; CWE-507 to 512 are trap; 912, 59, 73, 276 and 732 enter the table;
- docs/decisions/2026-10-31-impact-classes-every-cwe-widened.md (LMR1e-2);
- docs/decisions/2026-10-31-impact-classes-takeover-direct.md (LMR1f);
- this record (LMR1g).

So the first record's unclassified list no longer holds for 506, 912, 59, 73, 276 and 732; `DECIDED_UNCLASSIFIED` and `TRAP_CWES` in packages/cli/src/security/impact.ts are the current lists. The review of 42e30b6 asked for that pointer (PR #236 comment 6541677765, point 7).

LMR1f wrote these additions into earlier records: a line pointing onwards in the first record, the conditions record and the every-cwe-widened record, a sentence under point 6 of the conditions record, and a changed Check line and a "Since then" line in docs/mistakes/2026-10-31-impact-classes-test-the-table-cannot-build.md. Decision and mistake records are not rewritten; a later record says what changes (ludion-ops#1 comments 6542062338 point 1 and 6543282859 point 5). So LMR1g restores those four files to their text at 42e30b6. The takeover-direct record's words "adds one sentence to point 6" and "with a line pointing here" describe those additions. The sentence stands in that record's point 1 and, extended, in point 1 here; this section holds the pointers. The mistakes record's "13 sets and 33 pairs" is the number when it was written; the current number is in the test and the progress records.

## Measured with it (defined before counting)

On the same two zips (sha256 checked), in Docker with no network, every record is classified by three impact.ts files:
- **LMR1d**: the impact.ts of f25d51b;
- **LMR1f**: the impact.ts of 84ef289, PR #236's head before this lane (the same file as cc44cbd's);
- **after**: the new one.

For each, among records that are not MAL-:
- the share classified, per ecosystem and together;
- the count of each class;
- unclassified by reason: the vector rules out every class; no vector and two or more classes; no CWE in the table; no CWE; an unreadable vector;
- for each set with one class, how many records the vector made unclassified.

The changes LMR1f → after and LMR1d → after, each by direction (from → to). Every record that moved to a stronger class, one by one, for both. **The records that moved to impersonate and to takeover are counted apart and listed one by one**, for both, by the class they came from.

## Undo

A later decision, with its own record.
