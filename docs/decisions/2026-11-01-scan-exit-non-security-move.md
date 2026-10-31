# 2026-11-01 — `ludion scan` counts an image move only when a newer security release lies between (LSCANX)

**Lane LSCANX.** Set up by the coordinator (Grok) on 2026-11-01 01:1x JST under 6525272283 (a coordinator may start a lane for a bug or a factual error), to fix item 2, "bugs and factual errors", of the first-principles audit in ludion-ops#1, comment 6545633020, which read main 40ab08a. Written and committed before the code, from main 40ab08a.

## The fault (audit 6545633020, item 2, checked again on 40ab08a)

- Since #239 (LIMGV, docs/decisions/2026-10-31-limgv-image-newest-built-release.md), an official PHP or Node.js image check has a candidate in three cases: a move with a newer security release between (`update_available`, no wait), a move with none while its 72 hours run (`wait`), and a move with none after them (`update_available`, `security_releases` empty). packages/cli/src/security/php.ts, `imageMove`.
- `ludion scan` counted every candidate the same way: packages/cli/src/security/cli.ts:78 (`found`, exit 1) and packages/cli/src/security/scan.ts:85 (`attention_required`) test only `candidate !== null`. So a move with no security release, while it waits included, exited 1 with `attention_required`.
- README.md:123 and packages/cli/README.md:123 say that scan "exits 1 when it finds a known vulnerability or a PHP or Node.js security release". The text line (cli.ts:73) printed `php: 8.4.29 · update 8.4.30`, saying neither that 8.4.30 is not a security release nor that the move is waiting.
- The site says the same: the "update" state (apps/site/src/strings/en.ts:44, ja.ts:46) is "A relevant PHP security release or known advisory matches an inventoried dependency", and the supported table's PHP runtime row (en.ts:132, ja.ts:134) detects "Official security releases" only.
- No test looked at scan's exit code for a move with no security release; the one with a security release between (node-image.test.ts, the byte-order-mark test) exits 1.

## The coordinator's words (the lane's instructions, word for word)

> 直し方の案（監査の案。違う直し方にするなら理由を判断記録に書く）：found と attention で、イメージの結果は security_releases が 1 件以上のときだけ数える。セキュリティ版の無い移動は終了コードに数えない。cli の文はセキュリティ版でないこと・待ちの間であることが分かる文にする。README の 2 か所とサイトの en/ja の文を、事実に合わせる（言い過ぎにしない。en と ja の両方）。

> 範囲：バグと事実の誤りだけ（6525272283 により調整役がレーンを立ててよい）。待ちの決まり（監査の 1、間にセキュリティ版があるときの待ち）は頭脳が判断するので、**このレーンでは変えない**。72 時間の待ちや、どの版へ動くかの選び方は今のまま。

## Decided (the audit's fix, as proposed)

1. **What scan counts.** In `ludion scan`, an official image check (PHP or Node.js) counts toward exit 1 and toward the project's `attention_required` only when its result has a candidate and at least one newer security release (`security_releases` has one entry or more). A move with no newer security release counts for neither, whether it is waiting (`wait`) or its wait has ended (`update_available`). A dependency check counts as before, and so does a failed check, an incomplete result or an unsupported inventory (exit 2).
2. **So the exit codes are:** 1 for a known vulnerability or a newer PHP or Node.js security release of the Dockerfile's line; 2 when there is none but something still needs attention; 0 otherwise, including when the only thing found is a move to the line's newest release with no newer security release. This is the README's sentence made true, with the move named.
3. **The move stays visible.** The check's own result is unchanged: its `status` (`wait` or `update_available`), `candidate`, `security_releases` (empty) and `wait_until` are in `scan --json`, and the text line names it. The project's `status` keeps its two values and their names; `no_known_updates` beside such a move means no known vulnerability and no newer security release, not that no move exists. Renaming it would change the JSON's values, which this lane does not do.
4. **The text line** of an image check is:
   - with a newer security release: `<php|node>: <current> · update <candidate>`, as before;
   - with none, while waiting: `<php|node>: <current> · newest release <candidate> of the line (no newer security release); waits until <wait_until>`;
   - with none, after the wait: `<php|node>: <current> · newest release <candidate> of the line (no newer security release); its wait ended <wait_until>`;
   - with no candidate: `no newer security release found`, as before.
5. **README.md and packages/cli/README.md, line 123** say that a move to the line's newest release with no newer security release is shown, waiting or not, and does not change the exit code.
6. **The site** (a separate PR, since merging apps/site deploys ludion.ai and the owner decides that): the "update" state names a newer PHP security release of the Dockerfile's branch; the "no-match" state, which a scan with only such a move now ends in, says that a newer release of the branch with no security release can still be shown, with its 72-hour wait; the PHP runtime row's "detect" adds the branch's newest release. en and ja both. The site's other wording about Node.js (it says runtimes beyond PHP are not supported) is not this lane's fault and is not changed.
7. **Unchanged.** Which release an image moves to, the 72-hour wait and when it applies (a move with a security release between still does not wait; that is the audit's item 1, for the brain), `patch`, `watch`, `deliver`, their exit codes and receipts, the commit and PR texts, exposure time, the gates and the wait table.

## Not covered

- The audit's item 1 (the wait of a move with a security release between) and items 3 to 5.
- A rename of `no_known_updates`, or a third project status for a move with no security release.

## Undo

A later record.
