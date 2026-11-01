# 2026-11-01 — What "complete" means: the completion sentence and C1 to C16 (LDONE)

**Owner-adopted policy, quoted verbatim.** On 2026-11-01 at 11:49 JST the owner told the Claude chat, of its document 「Ludion 完成の定義」 (rev 9): 「それを方針にしような」. The Claude chat posted the decision with the document's full text at 11:50 JST, as comment 6552532457 on the operations board (ludion-ops#1). This record keeps that post from its section 「## オーナーの言葉」 to the end of the document, word for word, below. Left out: the post's opening line, its section 「## Grok がすること」 (the order of work, not part of the definition), and its closing signature.

CLAUDE.md, Goal, says that what "complete" means in measurable terms is fixed with the owner. This is that definition. docs/status.md, "Missing before complete", now lists C1 to C16 with how each is measured, its line and where it stands, as the post's tables give them, apart from the changes below.

## What this record does and does not settle

- Adopted from today, as the post's 「読み方（頭脳）」 says: the completion sentence, the conditions C1 to C16, the scope proposal and the order. Of the document's eight items for the owner, seven are decided as recommended; the eighth, Maven, was decided later the same day (below).
- **Maven is to be taken out of what Ludion fixes.** Taking Maven out narrows the scope, and an OK to a list does not approve a scope change inside it (CLAUDE.md, How we work, Scope), so the post left the one sentence 「Ludion は Maven の依存を直さなくなる（読むだけの確かめは残す）」 for the owner's own OK. The owner gave it on 2026-11-01 at 13:09 JST (「OK外す」; ludion-ops comment 6553240418). Maven's read-only check stays. Whether and when Maven's code is removed is not part of that decision; until it is, the code is unchanged.
- **Left open** (空けてある), and not filled in here or in docs/status.md:
  - the lines of C1 and C2: after LT2;
  - the scope apart from Maven, C4's strata, C10's denominator, and what gate 3 checks for a project with no tests: after LV0;
  - C9's 60 days: after the design of something that starts the run from outside (it touches CLAUDE.md:45).
- **Three changes to the quote's "今" (today) column**, made here and in docs/status.md rather than in the quote, which stays word for word. The first two correct it (an audit of the definition, ludion-ops comment 6553002811, item 3); the third adds a definition:
  - C1's 「過去の悪性 1,148 版で、公開時にタグがあったのは 0」 is stronger than what LT (#229, not merged) measured: 44 of the 1,148 are tied to a tag in their repository today, and in the 702 with a GitHub repository, GH Archive has no record of that tag being created within 24 hours before or after the version's publication. Tags created earlier than that were not looked at, and the 446 without a GitHub repository could not be checked for tags.
  - C3's 「200 件中 35 件」 and C7's 「合格（16.4h n=6、0h n=21、41.5h n=138）」 are backtest v4's (the judge of 2026-10-28, docs/bench/2026-10-28-backtest-v4). They have not been measured again with main's judge, which has changed since.
  - C9's 「q 約 0.17〜0.19」 does not say what q is. docs/status.md adds it: of the hourly slots, the share in which GitHub started a run, as the board post that measured q defines it (ludion-ops comment 6542899951; the same audit, item 5 (i)).
- **One addition to how C7 is measured**, made in docs/status.md and not in the quote: besides the median, C7 gives the share of fixes whose wait was extended and the p90 (the Claude chat, ludion-ops comment 6553345976, item 5, from the same audit's item 5 (iii)). Neither has been measured, and no value is given for them.
- Not changed by this record: CLAUDE.md (a sentence there pointing to this record is a separate protected change, which the owner merges), the wait table, and the numeric criteria of any gate.

## The post, from 「## オーナーの言葉」 (comment 6552532457, verbatim)

## オーナーの言葉（チャット、2026-11-01 11:49 JST、そのまま）

「それを方針にしような
Grokに伝えろ」

「それ」は、頭脳が 11:40〜11:48 JST に書いた文書「Ludion 完成の定義」（Claude Docs、https://claude.ai/artifact/U7G662hDNu3dkjdV8ehWvH ）。

- **土台：** 別の Claude の案（main dbfb3c6 から書いたもの）。
- **頭脳が直したこと（4 つ）：**
  - 悪性の数え方を「版で 299 件」から「自動マージ 1 回あたりの確率」にした。
  - 守る相手を、AI で作る個人開発者にした。
  - オーナーがもう決めたことを入れた。
  - 条件を 3 つ足した（60 日、壊れたら戻す、守りの記録）。

## 読み方（頭脳）

- 完成の一文、条件 C1〜C16、範囲の案、順番を、今日から方針にする。
- 文書の「オーナーが決めること・今」の 8 つは、推奨のとおりに決まった。ただし、Maven の一つを除く。
  - **Maven を直す範囲から外すこと：** 範囲を狭める変更。CLAUDE.md:18 では、一覧への OK はその中の範囲の変更を承認しない。だから頭脳が、一文（「Ludion は Maven の依存を直さなくなる（読むだけの確かめは残す）」）だけ、オーナーに確かめている。それまで Maven は、今の扱いのまま。
- 「数が出てから」の 4 つは、空けたまま。

*(Left out here: the post's section 「## Grok がすること」.)*

## 全文（文書 rev 9 のまま）

### 完成の一文

**完成とは、Ludion が「対応する」と書く範囲のすべてで、公式の修正が出てからマージまでを人の手なしで回し、四つの関門と待ちを通し、壊したら自分で戻し、下の C1〜C16 を同時に満たしている状態である。**

- 一つでも欠けたら完成ではない。範囲を広げれば、その範囲にも同じ線がかかる。
- 出す日から、件数の条件を満たした生態系では、自動マージを既定にする。満たさないものは PR で止める（オーナーの OK、10/31 12:19）。

### 範囲（案。LV0 の数が出てから決める）

| 種類 | 今の Ludion | 完成に入れるか（案） |
|---|---|---|
| npm（package-lock.json） | 直す。関門 2 の判定を通るのはここだけ | 入れる |
| npm（pnpm・yarn・bun の lock） | 読まない | LV0 で多ければ入れる |
| PHP・Node.js の公式イメージ（同じタグの作り直しも） | 系列で Docker がまだ作る一番新しい版に動かす | 入れる |
| Composer | 直す。関門 2 の判定は通らない | 入れる。LV0 で PHP が少なければ順番を後ろに |
| Maven | 手元でだけ動く | 外す（一文にオーナーの OK が要る） |
| Python・Go・Rust | 読むだけ | 修正は外す。読むだけの scan は残す |
| OS の系列の移動、EOL、メジャー更新、ほかのランタイム | 対象外 | 外す（OS の系列は LRR の数で再考） |

- **テストの無いプロジェクト：** 何を確かめれば「壊さない」と言えるかを、LV0 の数で決める。候補は、ビルド、型、起動、同じページの比較。
- **一つのフォルダで直せるのは、一つの生態系だけ。** 広げるかは、LR3 の数で決める。

### 安全

| 条件 | 測り方 | 合格の線 | 今 |
|---|---|---|---|
| C1 悪性：自動マージ 1 回あたりの危険 | 攻撃ごとに数え（k）、計画が悪性の版を選びえたか、MAL- が付くまでの時間を測る。「選びうる悪性の割合 × 見逃しの率」の上限 | 空けてある（LT2 の後、オーナー） | 未測定（過去の悪性 1,148 版で、公開時にタグがあったのは 0） |
| C2 悪性：これから（シャドー） | 公開するコードで、新しい定義と窓で数え直す。単位は攻撃 | C1 と同じ表で決める | 記録中 |
| C3 本物の修正を止めない | 過去の本物の npm セキュリティ修正で、止めた・判定不能の割合 | 5% 以下（95%） | 200 件中 35 件 |
| C4 壊さない | 当てた後、ビルド・テスト・起動が壊れた率。標本は守りたい人のプロジェクトに似せる。1 プロジェクト 1〜3 件 | 1% 以下（95%）。壊れ 0 なら 299 件 | 未測定 |
| C5 壊れたら戻す | 自動マージの後、main の CI かデプロイが失敗したら、Ludion が自分で戻す。1 修正 = 1 コミット = 1 PR | 試験で、戻すべき件を全部戻す。lock が元と同じ | 未実装 |
| C6 安全の決まり | 「Ludion must not become the attack path」の決まりそれぞれに、破れたら落ちる確かめ | 全部にある。候補を動かすジョブが書ける場所 0 | 未達（キャッシュの穴） |

### 速さ、勝手に動くこと、人の手間

| 条件 | 測り方 | 合格の線 | 今 |
|---|---|---|---|
| C7 関門が足す遅れ | 公開から「当ててよい」までの中央値、緊急度ごと | 24h・24h・72h | 合格（16.4h n=6、0h n=21、41.5h n=138） |
| C8 露出時間 | （プロジェクト, 勧告）ごと、Kaplan–Meier の中央値 | 中央値 72 時間以内 | 未測定（基準：Ludion なし中央値 9 日、Dependabot か Renovate ありは 0 日） |
| C9 勝手に動く | GitHub の起こした時刻を単位に q と分位。静かな公開リポジトリでも止まらないこと | 止まらないと確かめる。だめなら限界として書く（オーナーが選ぶ） | q 約 0.17〜0.19。60 日で止まる |
| C10 勝手に守れる割合 | LV0 の層と、公式イメージの層（浮くタグも分母）。層ごとに 97 件以上 | 空けてある（オーナー） | 0/100（版を固定した層だけ） |
| C11 人の手間 | 1 リポジトリ 1 週あたりの時間。赤は人の手が要るときだけ、倍々で知らせ直す | 週 5 分以下 | 未測定 |

### 届け方、自動マージ、守りの記録、公開

| 条件 | 測り方 | 合格の線 | 今 |
|---|---|---|---|
| C12 範囲ごとに作り終える | status.md の Not built の残りと、GitHub 上の通しの実行 | 残り 0。1 回目に PR 1、2 回目に 0 | GitHub で通したのは npm と PHP のイメージだけ |
| C13 自動マージ | 確かめた SHA でのマージ、直前の再照会、適用の設定、壊れたら止める。C1・C2・C4・C5 が合格 | 生態系ごとに開ける | 未実装 |
| C14 守りの記録 | PR の一番上に、Ludion 独自の分類で直す穴。利用者のリポジトリにたまる表 | 「直した」はマージされたものだけ。「罠」は公開の記録があるものだけ。事実より強い文 0 | 分類は main（#236）。つながっていない |
| C15 実利用 | Ludion-ai 以外の人の実リポジトリ。意見でなく行動を測る | 5 人。壊れた自動マージ 0。件数の線はオーナー | 0 人 |
| C16 公開するもの | npm、Action、サイト | npm は publish.yml から、来歴つき、依存 0、スクリプト 0。Action は SHA 固定で CLI 同梱。サイトは作っていないことを書いた文 0、英日で同じ、一番上に知識の無い人向けの節、なぜ要るかは CVE-2024-4577 から | 未達 |

### もう決まったこと（CLAUDE.md には LC0a・LC0b で入る）

- 出す日から自動マージを既定に（10/31 12:19）
- 件数と p0、「厳格に」（10/31 09:29）
- 決定 3（同日）
- 決定 B と、セキュリティを運ぶ移動への広げ（同日、11/1 08:33）
- 公式イメージの「一番小さい修正版」は、系列で Docker がまだ作る一番新しい版
- CLAUDE.md:17 と :21
- 個人は無料、課金は後で大口から（10/31 12:17）
- 守りの記録の分類は Ludion 独自（10/31 12:43）

### 空けてある所

- C1・C2 の線：LT2 の後。
- 範囲、C4 の層、C10 の分母、テストの無いプロジェクトの関門 3：LV0 の後。
- C9 の 60 日：外から起こす仕組みの設計の後（CLAUDE.md:45 に関わる）。
