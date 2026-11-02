# 2026-11-01 — CLAUDE.md catches up with seven sentences already decided, and its limit becomes 14,000 bytes (LC0a)

**Decided by the coordinator's brain** (the Claude chat) in ludion-ops#1, comment 6556208299 (2026-11-01 18:36 JST), items 1 and 2. The owner's words below are those the brain's table points to; ids are comments in ludion-ops#1. This is a protected change: it takes effect when the owner merges it.

The brain's reason, in short: every session reads CLAUDE.md, but no session reads every decision record. When CLAUDE.md says something other than main's code, a review either reads correct code as a violation or learns that CLAUDE.md need not be followed. Both harm more than writing a sentence that relaxes a rule, and each such sentence here has the owner's OK.

## The seven sentences

Sentences 3, 4, 5 and 6 relax what CLAUDE.md said before. Sentence 7 tightens it. Sentences 1 and 2 add a reading and a duty.

### 1. Goal: the smallest fixed version of an official image

- In CLAUDE.md: "; for an official image, that is the newest release of its line that Docker still builds in the project's variant, because only that tag gets OS-package rebuilds"
- Decided in comment 6541349120, item 1. The owner adopted it with the definition of complete: 「それを方針にしような」 (2026-11-01 11:49 JST, comment 6552532457), whose list of what is already decided has 「公式イメージの「一番小さい修正版」は、系列で Docker がまだ作る一番新しい版」.

### 2. How we work, Mistakes: mistakes in reports

- In CLAUDE.md: "A mistake in a report on the board is recorded the same way, and a report that says what a PR contains names the head SHA it read."
- The owner, 2026-10-31 09:29 JST (comment 6536521138): 「④OK」, to 「CLAUDE.md:17：板の報告の誤りも、docs/mistakes に記録する。報告で PR の中身を言うときは、読んだ head の SHA を書く。」

### 3. Goal: what is not a release

- In CLAUDE.md: "Giving a commit SHA to users the owner invited, without an announcement, is not a release; automatic merge there still needs (a) and (b)."
- The owner, 2026-11-01 13:24 JST (comment 6553380072): 「全部推奨で行く」, whose item 1 has 「告知せずに招待した利用者に、コミットの SHA で渡すことは、"出す"に数えない」 and 「招待した利用者のところでも、自動マージを開けるのは、件数の条件がそろった生態系だけ（今の決まりのまま）」. "(a) and (b)" is the brain's wording of that second sentence in comment 6556208299: (a) and (b) are CLAUDE.md's rule as it stands.

### 4. How we work, One at a time: what counts as a conflict

- In CLAUDE.md: "; a required check that does not run on the old base counts as a conflict"
- The owner, 2026-10-31 09:45 JST (comment 6536714532): 「推奨で行こう」, whose item b is 「CLAUDE.md:21 に「古い base で必須のチェックが動かないときも、衝突に数える」を足す。」

### 5. Product, gate 3: a patch within the line of an official image

- In CLAUDE.md: "For a patch within the line of an official image, gate 3 is: it builds, it starts and, if it has tests, all pass; having no test that passes on old is not by itself a reason to stop."
- The owner, 2026-10-31 09:29 JST (comment 6536521138): 「①OK」, to 「公式イメージの同じ系列のパッチでは、古い版で通るテストが無いことだけを理由には、Ludion は止めなくなる（ビルドが通ること、起動すること、テストがあれば全部通ることは、今までどおり確かめる）」.
- This narrows a gate, so CLAUDE.md's Scope rule asks for the owner's OK on one sentence. ① is that OK. docs/decisions/2026-10-31-gate-3-official-image-same-series.md, which waited for it and for this change to CLAUDE.md, takes effect with this one (comment 6556208299). It names the change "LC0"; this is the part of LC0 that carries it.

### 6. Product, the wait: official runtime releases

- In CLAUDE.md: "A security release in an official runtime's line, and an official image's move across one, become a PR without waiting; the wait of automatic merge is decided separately."
- Decision B. The owner, 2026-10-31 09:29 JST (comment 6536521138): 「②OK(世間が見つけるまで待つのは愚かだ)」, to 「公式ランタイムの同じ系列のセキュリティリリースは、待ちの表によらず、待たずに PR にする（自動マージの待ちは別に決める）」.
- The move across one. The brain widened decision B in comment 6550639256, item 6 (waits are the brain's to decide, comment 6525272283) and told the owner in one line; the owner's own words on that line are not on the board. The definition the owner adopted in comment 6552532457 lists 「決定 B と、セキュリティを運ぶ移動への広げ（同日、11/1 08:33）」 among what is already decided. docs/decisions/2026-11-01-image-move-across-security-release-no-wait.md gives the reasons. CLAUDE.md says this from the same merge as that record (`git grep -c "move across one" CLAUDE.md` gives CLAUDE.md:1). `patch` does not call the judge for an image (`grep -c judge packages/cli/src/security/patch.ts` gives 0), so CLAUDE.md's Product also says, after this PR's review, by the brain's decision of 2026-11-02 JST: "An official image's move has no re-query, and across a security release no wait, so a hijacked official tag is not caught before the PR."
- A move with no newer security release has no advisory and still waits the normal 72 hours (comment 6541349120, item 2 (i)).

### 7. Engineering and security: containers that count as the host

- In CLAUDE.md: "A container given the Docker socket, or a writable mount of the work tree, can act on the host, so it counts as the host."
- A fact that tightens a rule, from the audits in comments 6548304372, item 1 (e), and 6549505261, item 1, and the brain's table in comment 6556208299, which says the owner's merge is its OK. So the owner has not yet given an OK to this sentence; the merge is that OK.

## The limit

CLAUDE.md's limit goes from 12,000 to 14,000 bytes, in CLAUDE.md (How we work, Records) and in tools/records/test/records.test.ts (comment 6556208299, item 1). 13,000 would leave about 30 bytes and meet the same wall at the next sentence. The limit's job is that each addition passes under the owner's eyes; the number is on a protected path, so raising it needs the owner's merge too, and that holds at 14,000. The 12,000 in docs/decisions/2026-10-29-way-of-working.md and docs/mistakes/2026-10-29-the-cut-redefined-ludion.md is what was true when they were written; they stay as they are.

## The test job's time limit

.github/workflows/test.yml's job limit goes from 15 to 30 minutes, and its two Chromium install steps get a limit of 5 minutes each (comment 6556208299, item 2). The owner's OK on the 30 minutes: 「全部推奨で行く」 (comment 6553380072, item 3, which named another PR for it; comment 6556208299 moves it here). The 5 minutes are the brain's. This changes no gate; it is recorded here so that the seven sentences' PR explains all of itself.

## What this does not change

- The wait table's numbers and any gate's numeric criteria. Sentence 6 says which releases go to a PR without waiting; it decides no wait for automatic merge.
- The record of the definition of complete, and the earlier records named above.
- The code. Where CLAUDE.md now says more than main's code, docs/status.md lists it under "Missing before complete".

## Undo

A protected PR that takes the sentences out of CLAUDE.md, with the owner's merge, and a new decision record saying why.
