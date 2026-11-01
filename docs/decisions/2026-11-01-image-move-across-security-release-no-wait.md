# 2026-11-01 — An official image's move across a security release does not wait, even when its target is not a security release (LC0a)

**Decided by the coordinator's brain** (the Claude chat) in ludion-ops#1, comment 6550639256 (2026-11-01 08:33 JST), item 6, answering the audit in comment 6545633020, item 1. Waits are the brain's to decide (comment 6525272283: 「目標・範囲・関門・待ち・決まりに関わるものは、頭脳が判断する。」). The item is quoted word for word below. Written from main 4aefb22.

## The decision (comment 6550639256, item 6, verbatim)

> ## 6. 公式イメージの、セキュリティ版をまたぐ移動の待ち（監査 6545633020 の 1）
>
> - **決める：** 間にセキュリティ版がある移動は、目標（系列の一番新しい版）がセキュリティ版でなくても、待たない。
> - **理由：** 待ちは移動の緊急度で決まる。この移動は、セキュリティの修正を運ぶ。目標をセキュリティ版に留めると、OS の作り直しが止まったタグに乗る（6540818608）。PR を二本に分けると、雑音が増える。
> - **扱い：** 決定 B（オーナーの OK、6536521138 の ②）を、セキュリティの修正を運ぶ移動に広げることになる。待ちの判断は頭脳がする（6525272283）。オーナーには、頭脳から一行で伝えた。
> - すでにセキュリティ版の上にいるプロジェクトの、同じ版への移動は、勧告が無いので normal の 72 時間（6541349120 の 2 の (i)）。
> - 判断記録を書く（LC0a で CLAUDE.md:33 にも）。

In English: a move of an official image with a security release between the Dockerfile's version and the target (the newest release of the line) does not wait, even when the target itself is not a security release. A project already on or past that security release, moving to the same target, has no advisory for the move and waits the normal 72 hours.

## The owner's words

- **Decision B**, which this widens. The owner, in the chat, 2026-10-31 09:29 JST (comment 6536521138): 「②OK(世間が見つけるまで待つのは愚かだ)」. Decision B, as that comment gives it: 「公式ランタイムの同じ系列のセキュリティリリースは、待ちの表によらず、待たずに PR にする（自動マージの待ちは別に決める）」.
- **The widening.** The brain told the owner in one line (item 6 above); the owner's own words on that line are not on the board. The definition of complete, which the owner adopted on 2026-11-01 at 11:49 JST (「それを方針にしような」; comment 6552532457, quoted word for word in docs/decisions/2026-11-01-definition-of-complete.md), lists among what is already decided: 「決定 B と、セキュリティを運ぶ移動への広げ（同日、11/1 08:33）」.

## Why the audit raised it (comment 6545633020, item 1, in short)

Before PR #239, the candidate of a move across a security release was that security release itself, so decision B covered it. Since #239 (docs/decisions/2026-10-31-limgv-image-newest-built-release.md), the candidate is the line's newest release, which can be a later release that is not a security release, and the move still did not wait. Decision B covers security releases only, so the move's wait had not been decided by anyone. This record decides it.

## What main does

On main 4aefb22, `imageMove` in packages/cli/src/security/php.ts (used for both the PHP and the Node.js official images) already behaves this way: with at least one security release of the line newer than the Dockerfile's version, the move to the line's newest release has no wait; with none, it waits until 72 hours after the end of the candidate's release day. This record changes no code.

## What this record does not change

- CLAUDE.md. Its wait table (Product) has no exception for decision B or for this move. The brain's item 6 asks for CLAUDE.md:33 to say it as well; that sentence is not in this PR (see its description), so CLAUDE.md does not yet say it.
- The wait table and any gate's numeric criteria.
- The wait of automatic merge, which decision B leaves to be decided separately.

## Undo

A new decision record that gives such a move a wait, and the code in `imageMove` that applies it.
