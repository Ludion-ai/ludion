# 2026-10-31 — Impact Classes: trap is a published record that says the version is malicious; other stops are "could not be verified", by reason

**Decided 2026-10-31** by the owner's Claude chat (ludion-ops#1 comments 6538877641 and 6538690397, point 5), for PR #236 (lane LMR1b). It changes points 3 and the CWE-506 row of docs/decisions/2026-10-31-impact-classes.md, which stay as written; this record says what replaces them. Written and committed before the share classified was measured again.

## The chat's words (6538877641, kept short)

- 「trap の定義は『その版そのものが悪性』。CWE-506（Embedded Malicious Code）は、その定義そのもの。」「守るべき線は、MAL- かどうかではなく、『外の公開の記録が、悪性と言っているか』。Ludion が自分の検査で止めたものは、罠と数えない。」
- 「id が MAL- で始まるか、aliases に MAL- の id があれば、trap。」
- 「renderRecord の入力に、止めた理由を持たせる。表には、理由ごとに分けて書く」「『罠』と書くのは、上の 1・2 の公開の記録があるものだけ。それ以外で止めたものは、『確かめられなかったので止めた』と書く。」「まとめの一行で『罠』として出す数は、公開の記録があるものだけ。」

## Decided

1. **trap** (`classify`) is a record that a published record says is malicious, in this order:
   - its OSV `id` starts with `MAL-` (OpenSSF Malicious Packages);
   - one of its `aliases` starts with `MAL-`: the same case written in another database;
   - its `database_specific.cwe_ids` lists CWE-506 (Embedded Malicious Code): a GitHub-reviewed malware advisory. In the 2026-10-31 exports measured for #236, 403 records that are not MAL- listed CWE-506.

   Each prefix is matched exactly (case and leading spaces count, as for the id). A record with no id stays unclassified. CWE-506 is the only CWE that makes a trap; CWE-912 (hidden functionality) stays unclassified, as decided in the first record, because its definition does not say the code is malicious.
2. **A stop in the protection record** (`renderRecord`) carries its reason. A row whose action is `stopped` must have one, and a row with any other action must not.
   - **Trap:** the reason is `trap` with the published record itself (the OSV record). `renderRecord` runs `classify` on it and refuses the row unless it is trap, so "trap" is written only when a published record says the version is malicious. The cell names the record's id.
   - **Anything else** Ludion stopped on its own checks is written "could not be verified, so stopped" (確かめられなかったので止めた) with its reason, and is never counted as a trap. The reasons, each the kind of judge.ts finding it stands for:

     | reason | English | 日本語 | judge.ts's stop findings |
     |---|---|---|---|
     | provenance-lost | provenance lost | 来歴が切れた | the old version had build provenance and the new one has none |
     | provenance-changed | built from another repository or workflow | 作り元が変わった | another repository, workflow or repository id; only one records an id |
     | install-scripts | install scripts added | install スクリプトが増えた | adds install scripts; runs them with no comparable predecessor |
     | deprecated | deprecated | 非推奨になった | the new version is deprecated |
     | withdrawn | no longer listed by the registry | 取り下げられた | unpublished or withdrawn |
     | replaced | another package under the same name | 同じ名前の別のパッケージ | the path now installs another package |
     | new-advisory | the new version has known advisories | 新しい版に既知の勧告がある | advisories the old version did not have |
     | downgrade | the version goes down | 版が下がる | the version goes down |
     | after-fix | published at or after the fix | 修正の後に公開された | time cap: published at or after T, or a new dependency younger than the wait |
     | lockfile | the lockfile or the changed files do not check out | ロックファイルか変更の範囲が合わない | Gate 4's stops |
     | tests | tests fail on the new version | 新しい版でテストが通らない | Gate 3 |
     | undecidable | could not be judged | 判断できなかった | a lookup failed, no registry facts or publish time, an undecidable time cap |

     A finding judge.ts reports as "in OSV's malicious-package records" is a trap only when the record is passed and classifies as trap; the wiring (the next lane) passes it.
3. **The summary line** counts traps apart, and only those: "trap stopped N" (罠を止めた N), then "could not be verified, so stopped N" with the count of each reason in the order of the table above, beside the other actions as before.
4. Unchanged: the classes, the strength order (trap is the strongest), GHSA severity only, the CWE table's rule, and that the record is not wired into a PR body or job summary yet.

## Not done here (6538877641, point 2)

judge.ts and the choice of the next version (next-fix.ts) still read a record that names a MAL- id only among its aliases as an ordinary advisory, while the scan counts it as MAL- (docs/status.md). The chat decided to align them to the stricter reading in another lane (LMALIAS), after #215 and #231 merge, with its own decision record and a test that an update stops on such a record. This record does not change judge code.

## Undo

A later decision, with its own record.
