# 2026-11-02 — Corrections to the owner's plan, made after it was written (LPOLDOC)

The plan 「Ludion 完成の定義：最終決定（11-02）」 is copied in docs/decisions/2026-11-02-definition-of-complete-final.md, without its operational lines. **This table wins over that text.** Where the two conflict with CLAUDE.md, CLAUDE.md wins until the protected PR lands.

"方針の行" is the line number in the plan's own text, sha256 1e301f80a4b389bdc9623b4db7e912eff8fbfc7d97b2f1495b79f0a3a1b6c5c7; the copy has line N at its line N+7. "正本の文" is quoted word for word. 頭脳 is the Claude chat; its answers are dated below. The rows for :142, :144, :146, :173 and :182 are also in PR #262's record, "Where this tightens the plan" (not merged when this was written); the English in their "今の文" is that record's "Now" column, word for word. Times are JST.

| 方針の行 | 正本の文 | 今の文 | 誰が決めたか | オーナーの OK（日時 JST） |
|---|---|---|---|---|
| :65、:81 | 「V 以外で動かざるをえない版は、範囲を満たす最古で、勧告・廃止・取り下げの無いもの。」（:65）、「最古が既知の脆弱」に「勧告を見て、次に古いものへ」（:81） | 測る相手は「今より悪くならない」と、V を main の next-fix の規則で上げる腕。最古は、版の番号ではなく公開の時刻で決める。廃止と取り下げは、関門 2 の止めるもののまま。 | 頭脳（Q3、2026-11-02 09:50）、#262 | 不明 |
| :104 | 「k=0 でも合格。」 | 「合格」と書く文は、同じ行に n と 95% の上限を書く。0/2 なら 77.6%。 | 頭脳（Q6 §5、2026-11-02 09:50） | 不明 |
| :118 | 「線：95% の上限で 5% 以下、つまり 1,000 件で止まり 38 件以下。」 | 線は 2 本。出たばかり（勧告の公開の時）は、方針の線（1,000 件で止まり 38 件以下）。初回（Ludion を入れた日、古い lockfile）は数を出し、線は数を見てからオーナーが 11-28 の前に決める。 | 頭脳（Q10、2026-11-02 09:50） | 不明 |
| :124 | 「古い版で状態 200・例外 0 のページが 1 つ以上ある（プロジェクト, 修正）だけ。」 | （パッケージ, 版の移動）ごとに 3 件まで。プロジェクトごとの今の上限も残す。結果は行ごとと、違う修正ごとの両方で出す。 | 頭脳（Q11、2026-11-02 09:50） | 不明 |
| :130、:229 | 「ludion-sandbox（別リポジトリ、公開、Actions の matrix、箱の中、書き込み権限・秘密・キャッシュ無し）」（:130）、「ludion-sandbox（公開、Actions、箱の中）」（:229） | Actions に置かない。 | オーナー（頭脳の勧め） | 2026-11-02 10:35（6 項目の一覧への 1 回の返事） |
| :142 | 「直前に再照会し、停止ファイルを読む。」 | A file that cannot be read holds automatic merge, and the PR waits for the next run | 頭脳（Q6 §1、2026-11-02 09:50）、#262 | 不明 |
| :144 | 「デプロイの状態、main の check、本番のクロールのどれかが失敗なら、1 回だけ再実行する。また失敗なら、その 1 commit を戻す PR を自動でマージする」 | Only the deployment status and main's check. A failed crawl notifies and stops that repository's automatic merge | 頭脳（Q6 §1、2026-11-02 09:50）、#262 | 不明 |
| :146 | 「書くのはオーナーと、証拠（戻せなかった PR の URL）つきの自動。」 | The owner only; automation only notifies | 頭脳（Q6 §1、2026-11-02 09:50）、#262 | 不明 |
| :173、:182 | 「Dependabot の PR はその場で draft にして「Ludion が保留中」と書き、Ludion の PR が出たら理由を書いて閉じる。」（:173）、「draft にして保留を書き、Ludion の PR が出たら閉じる」（:182） | Ludion does not touch it. Ludion's own PR for the same advisory links it in one line。層 2 の workflow は合図を受けて discovery を起こすだけで、`pull-requests` の権限を持たない。 | 頭脳（Q9、2026-11-02 09:50）、#262 | 不明 |
| :230 | 運用の行なので、ここには引かない（写しでは第 1 列の括弧と第 3 列の中身を消した） | 影の置き場は、正本の文を今の事実として読まない。置き場は公開に書かない。 | 頭脳（2026-11-02 13:53） | 2026-11-02 10:35（6 項目の一覧への 1 回の返事。その時の置き場について）。公開に書かないことは不明 |

"不明" means no record of the owner's OK with a date was found for that row. #262 asks the owner's merge of it to be the OK of the sentences it puts into CLAUDE.md: :104's sentence, and those on the oldest version, the stop file, the revert and Dependabot. It has not been merged.

Not changed by this record: CLAUDE.md, the wait table and any gate's numeric criteria.
