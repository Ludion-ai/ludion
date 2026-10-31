# 2026-10-31 — An official PHP or Node.js image moves to the newest release of its line that Docker still builds in its variant (LIMGV)

**Lane LIMGV.** Decided by the coordinator's brain in ludion-ops#1: comment 6540818608, item 1, and comment 6541349120, items 1 to 5, which corrects 6540818608 where the two differ. The quotes below are word for word. This record replaces item 1 of docs/decisions/2026-10-31-lphpv-php-security-release.md and item 5 of docs/decisions/2026-10-31-lnode-node-image.md, which took the newest *security* release of the line. It also replaces the version choice of PR #238, which was closed unmerged (comment 6541660315 on #238). Written and committed before the code, from main 355a91c.

## The brain's words

### 6540818608, item 1

> ## 1. 公式イメージの版の選び方：案 (a)。頭脳の誤りを直す
>
> - **頭脳の誤り：** 頭脳は、監査 6539056558 の 3（PHP も Node と同じに、一番新しいセキュリティ版を取る）を、そのまま受け入れた。そのとき、公式イメージの作り直しの決まりを確かめなかった。docker-library が作り直すのは、系列の一番新しい版のタグだけ。だから、パッケージの考え方（全部の修正を持つ一番小さい版）を、それが成り立たないイメージに当てていた。
>   - 前の PHP の選び方（系列の一番新しいリリース）には、理由があった。でも、判断記録に書かれていなかった。今回、その理由を記録にする。
> - **Goal の読み方（判断記録に書く）：** 公式イメージでは、修正はランタイムと OS パッケージの両方に入る。OS の修正が入るのは、作り直される系列の一番新しい版のタグだけ。だから、「全部の修正を持つ一番小さいイメージ」は、系列の一番新しい版。
> - **決めたこと：**
>   - PHP と Node の公式イメージは、同じ系列の一番新しい版に動く。
>   - 動くのは、次の二つのとき。
>     1. 新しいセキュリティ版が出たとき。
>     2. 置いたタグが、系列の一番新しい版でなくなったとき（OS の作り直しが止まったとき）。
>   - 版の一覧は、今と同じ取得先（php.net、nodejs.org）から読む。送る先は増えない。
>   - **費用：** PR の数が増える（過去 365 日で、PHP 8.4 は 6 → 13、Node 24 は 5 → 17）。同じ系列のパッチの関門 3 は、決定 3 で軽くなっている。
> - **CLAUDE.md：** Goal の「smallest fixed version」に、公式イメージの読み方の一文を足す。LC0a に入れる（保護、オーナーがマージ）。
>   - 文の案：「For an official image, the smallest fixed version is its line's newest release, because only that tag gets OS-package rebuilds.」
> - **今すぐの事実の文：** docs/status.md の 4 と README に、監査の案 2 の一文を足す。直しが入るまで、置いたタグに OS の修正が来ない日があることを書く。直しが入ったら、その文を消す。
> - **LR3 と決定 4：** 完全な版の層の「守れる」には、「置いたタグが、まだ作り直されていること」を入れる。数える前に、定義に書く。
> - **レーン（LIMGV）：** 今動いている LPHPV2（e159468f）に、この決定を原文のまま渡して、切り替える。
>   - 判断記録を先に書く。php.ts と node.ts の選び方を直す。
>   - R237 の R5・R7・R10 は、新しい選び方に当てはまるものだけ、テストに入れる。
>   - テストに入れる場合：セキュリティ版でない一番新しい版、置いたタグが一番新しい版でなくなった日、系列の版の一覧が欠けているとき（止める）。
>   - LDG の定義は、このマージの後に固める。

### 6541349120, items 1 to 5 (these win where they differ from 6540818608)

> ## 1. 決まりは、状態の一文にする
>
> **「Dockerfile のタグが、その系列とその variant で Docker がまだ作る一番新しい版より古ければ、その版に動く」**
>
> - 6540818608 の「動くのは二つのとき」は、この一文に置き換える。1（新しいセキュリティ版）は 2 に含まれる。
> - 「置いたタグ」とは書かない。Ludion には、誰が置いたかが分からないため。
> - 二つの場合で違うのは、ラベルだけ。間にセキュリティ版があるか、無いか。
> - 6540818608 の CLAUDE.md の一文の案も、これに合わせる：「For an official image, the smallest fixed version is the newest release of its line that Docker still builds in the project's variant, because only that tag gets OS-package rebuilds.」（LC0a）
>
> ## 2. (i)〜(iii)：セキュリティ版の無い移動
>
> - **(i) 待ち：normal の 72 時間。** 今の待ちの表のとおりにする。勧告の無い移動は、急ぐ理由が無いので normal。表を変えないので、オーナーの一文は要らない。
>   - 間にセキュリティ版がある移動は、決定 B（6536521138 の ②、待たない）のまま。
> - **(ii) 露出時間：中央値に入れない。** 露出時間は（プロジェクト, 勧告）の数で、この移動には勧告が無い。
>   - 別の数として「OS の層の古さ」を出す。最後に動いた日からの日数の、平均と最大。監査 6541169970 の 2 の数え方と同じ。
> - **(iii) コミットと PR の文：事実だけを書く。** 例：「PHP 8.4.28, the newest release of the line (no newer security release); Docker rebuilds only the newest tag of a line」。「security release」と書かない。
>   - deliver.ts:155 の「security_releases を 1 件以上」は、この移動では 0 件を許す。そのとき、PR のジョブがコミットの文を作り直す形も、それに合わせる。
>
> ## 3. 届く時の文（監査の 2）：監査の案の文を使う
>
> - README と docs/status.md には、監査 6541169970 の 2 の 1 の文を入れる。Dockerfile はダイジェストで固定しているので、OS の修正がプロジェクトに届くのは、Ludion が動いたときだけ。LDG ができるまで、そう書く。
> - **LDGLAT（測るだけ、新）：** Docker の作り直しの遅れを測る。
>   - 各系列の一番新しいタグについて、毎時 digest と tag_last_pushed を記録する。Alpine と Debian のセキュリティの告知の時刻と比べる。
>   - 送るのはタグ名だけ。
>   - シャドーに 1 行足す形でよい（ludion-shadow は Ludion-ai のもの）。定義を先にコミットする。
>   - LDG の定義は、この数の後。
>
> ## 4. 無いタグ（監査の 3）：今は止めて、理由を言う。OS の版を動かすかは、数を見てから
>
> - **今（LIMGV に入れる）：** 候補のタグが Docker Hub にあるかを、dockerHubDigest と同じ HEAD で確かめる。送るのはタグ名だけ。
>   - 無ければ、update_available にしない。理由を言って止める。例：「Docker no longer builds php:8.4-fpm-alpine3.22 after 8.4.22; Ludion does not move the Alpine release」。
> - **OS の版を動かすか（alpine3.22 → alpine3.23 など）：** 頭脳の向きはこう。そのプロジェクトは、ランタイムのセキュリティ版も、もう受け取れない。だから、Docker がまだ作る一番近い OS の版に動くのが、「一番小さい修正」の考えを OS の軸に当てたものになる。
>   - ただし、関門 3 で壊れる見込みが、パッチより大きい。
>   - LRR（記録と再生の取得の測定）の標本で、移った場合のビルドと起動の割合を測ってから、決める。範囲を広げる変更なので、決めるのは頭脳。数によっては、オーナーに出す。
> - **LR3 と決定 4：** この層は分母に入れる。「守れる」には数えない。数える前に、定義に書く。
>
> ## 5. #238（監査の 4）：新しい PR にする
>
> - LIMGV は、main 355a91c（#215 の後）から、新しいブランチと PR で始め直す。#238 は、理由（決定 6540818608 と、この 1〜4 で置き換わった）を書いて閉じる。
> - R237 の R5・R10 のテストは、新しい選び方に当てはまる形にして持っていく。
> - **LIMGV の範囲：** php.ts、node.ts、patch.ts、deliver.ts、exposure.ts、README 2 つ、docs/status.md。
>   - 判断記録を先に書く。上の 1〜4 を原文で引く。
> - **壊れる側のテスト：**
>   - セキュリティ版の無い一番新しい版への移動が、PR のジョブ（openFixes）まで通る。
>   - PR の文に「security」と書かない。
>   - 無いタグで止まる。
> - 手で動かす確かめは、LNODE のように両方のジョブまで。

## Why

- **Only the newest tag of a line is rebuilt.** docker-library's FAQ (github.com/docker-library/faq, README.md, read by the audit in a container): "once 2.5.7 is released, 2.5.6 is no longer considered supported, but the Docker Hub tag is typically left available for pulling -- it will simply never get rebuilt after that point given that it is unsupported". An official image carries fixes in two places, the runtime and the OS packages, and the OS-package fixes reach only a tag that is still rebuilt.
- **How the Goal's "smallest fixed version" reads for an official image** (6540818608, item 1): the smallest image that holds every fix is the newest release of the line that Docker still builds in the project's variant. A package's contents never change after it is published, so its oldest fixed version holds every fix; an image's tag stops receiving OS-package fixes once a later release replaces it. The sentence for CLAUDE.md is LC0a, a protected PR the owner merges, and is not part of this lane.
- **What LPHPV and LNODE missed.** They applied the package reading to images. PHP's choice before LPHPV, the branch's newest release, was right for this reason, but no record said why.

## Decided (how this lane builds it)

1. **The state rule.** When the Dockerfile's version is older than the newest release of its line, the image moves to that release, marked security or not. The line is PHP's `X.Y` in php.net's JSON, or Node.js's major `X` in nodejs.org's index, as before; the flavor or variant is kept, as before. "That Docker still builds in the variant" is read as: that release's tag in the Dockerfile's variant (`<version><flavor>`, for example `8.4.30-cli-alpine`) exists on Docker Hub (item 4 below). Ludion reads no list of what docker-library builds.
2. **No move.** When the Dockerfile's version is the line's newest release, there is no candidate; the status `no_newer_security_release` keeps its name.
3. **A missing list stops.** When the Dockerfile's version is newer than every release of its line in the official list, the list lacks at least the release the project uses, so whether the tag is the newest cannot be read. The lookup fails and no update decision is made. A Dockerfile version below the newest release that is missing from the list is not a stop (php.net's 8.4 list on 2026-10-31 has no 8.4.0 and no 8.4.9). The other stops are unchanged.
4. **The tag must exist (item 4).** Before a move is reported as `update_available`, Ludion asks Docker Hub for the candidate tag with the same HEAD request `dockerHubDigest` makes (a pull token for `library/php` or `library/node`, then a HEAD on `/v2/library/<php|node>/manifests/<tag>`). Only the tag name is sent. The HEAD is moved from deliver.ts into php.ts, so that the scan and the PR job make the same request. When Docker Hub answers 404, the scan stops with this reason: `Docker Hub has no <php|node>:<tag>, the newest release of <PHP X.Y|Node.js X> in the Dockerfile's variant: Docker has not published it yet, or no longer builds this variant. Ludion does not move the variant or its OS release. No update decision was made.` Ludion cannot tell those two cases apart from the HEAD alone, so the reason names both. Any other answer (no token, no digest, another HTTP status) also stops, as a lookup that failed. Moving the OS release (alpine3.22 to alpine3.23 and the like) is not done, and waits for the brain's decision after LRR's numbers.
5. **Labels.** The two cases differ only in their label: whether a security release lies between the Dockerfile's version and the candidate. `security_releases` is still every release of the line newer than the Dockerfile's version that is marked security (PHP: `tags` includes `"security"`; Node.js: `security: true`), newest first.
6. **The wait (item 2 (i)).** A move with no security release between waits 72 hours, the wait table's normal row. The official lists give a day only, so the 72 hours are counted from the end of the candidate's release day (00:00 UTC of the next day): `wait_until` = release day 00:00 UTC + 96 hours. Starting from the end of the day keeps the wait at 72 hours or more, whatever the hour of publication; this is this lane's reading. Until then the scan's status is `wait` (a new status), with the candidate and `wait_until`; `patch` runs no Docker work and writes no receipt, and the tag is not asked for until the wait has ended, so a tag Docker has not published yet does not stop a run that is waiting. A release day that cannot be read stops the lookup, since the wait cannot be counted. A move with a security release between does not wait (decision B, 6536521138 ②), as before, and has no `wait_until`.
7. **Exposure time (item 2 (ii)).** A move with no security release has no advisory, so it is not a (project, advisory) pair of docs/decisions/2026-10-31-exposure-time-per-project-advisory.md and stays out of the median: its `fix_published_at` is null, with the note `Not counted: no newer <PHP|Node.js> security release; a move to the line's newest release has no advisory, so it is outside exposure time.` The PR job refuses such a receipt when `fix_published_at` is not null. The "OS layer age" (the mean and the maximum of the days since the last move) is not built in this lane: it needs the day each move reached the project, which is the exposure-time end (the merge), not recorded yet (docs/status.md, 2).
8. **The text (item 2 (iii)).** For a move with no security release, the commit's second paragraph is `<PHP|Node.js> <new>, the newest release of the line (no newer security release); Docker rebuilds only the newest tag of a line.` (the brain's example, with the version and a full stop). The PR job allows an empty `security_releases` for an image, requires `wait_until` and an `applied_at` not earlier than it, and rebuilds that paragraph from the checked fields. The PR's title (the commit's subject, unchanged) and body do not contain the word "security" for such a move: the body says the image moved to the line's newest release because Docker rebuilds only the newest tag of a line, that no advisory names the move, that it waited until `wait_until`, and that it is not counted in exposure time. A move with a security release between keeps its texts.
9. **README and docs/status.md (item 3)** get the sentence that, since the Dockerfile is pinned by digest, OS-package fixes reach the project only when Ludion moves it, until LDG is built. The audit's own wording of that sentence (6541169970, 2, 1) is not on main or in this lane's instructions, so this lane writes it from the brain's summary in item 3 (不明 whether it matches the audit's text word for word).
10. **Unchanged.** The sources and their limits (php.net's `?json&version=<X.Y>&max=100`, 1 MiB, 15 s; nodejs.org's `dist/index.json`, 4 MiB, 30 s), the digest pinning, the branch name (`ludion/php/<version>`, `ludion/node/<version>`), the receipt's schema number, the PR job's other checks, the gates and their number, the wait table's rows, and the scope. What is sent grows by the tag HEAD in `scan` and `patch`, to the two Docker Hub hosts `deliver` already uses (auth.docker.io, registry-1.docker.io), with the tag name only.

## Not covered

- LDGLAT (measuring Docker's rebuild lag) and LDG (a rebuild of the same tag).
- Moving the OS release of a variant Docker no longer builds (item 4; the brain decides after LRR).
- A Dockerfile whose own tag (not the candidate's) is no longer built in its variant: no tag is asked for when there is no candidate.
- LR3 and decision 4's definition of "protected", and the CLAUDE.md sentence (LC0a).
- The rest of the earlier records' "Not covered": gate 1's matching, gate 2's checks, end-of-life lines, and minor or major upgrades.

## Undo

A later record.
