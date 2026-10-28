下書き。送らない、公開しない。

# 記事の構成案：「バックテストで GitHub のマルウェアデータベースの誤りを見つけた話」

**状態：下書き・非公開。** 構成案のみ（本文ではない）。**公開するかどうかは、github/advisory-database Issue #10743 が解決した後にオーナーが判断する。** それまで外に出さない。

作成：2026-10-28 23:20 JST ごろ。数値はすべて docs/bench/2026-10-28-backtest-v5/（main `51a8f0b`）からの写し。

## タイトル案

1. バックテストで GitHub のマルウェアデータベースの誤りを見つけた話（仮題・指定どおり）
2. 「1 件の見逃し」を追ったら、データベースのほうが間違っていた ── npm マルウェア 1,148 版のバックテストから
3. 正解データを疑う：Software Heritage と jsDelivr で @ensdomains/buffer 0.1.1 を検証する
4. 止められなかった 1 件は、2023 年の正規リリースだった（※ Issue 解決前は使わない。断定になるため）

## 構成

### 1. はじめに：何をしているか
- Ludion とは何か（依存関係の更新を止める・待たせる判定）を 2〜3 行で。
- バックテスト＝過去に「悪性」と記録された npm の版を、当時の情報だけで止められたかを再現する検証。
- この記事の要点：見逃した 1 件を調べたら、正解データ（悪性リスト）側に誤りの可能性が見つかった。

### 2. バックテストの設計（v5）
- 対象：悪性とされた **1,148** 版（OSV の npm エクスポート、MAL- レコード）。
- 待機時間 4 段階（12h / 24h / 72h / 168h）、結果は「止めた / 見逃した / 不明」。
- 定義を実行前に commit して固定（definitions.md は 23ab295、20:42:52 JST）。「最初の実行が結果」。
- 新しい情報源：ecosyste.ms（版ドキュメントの写し）と Software Heritage（tarball の保管）。

### 3. 結果：ゲートは未達、見逃しは 1 件
- 主結果（保守的タイミング、例外あり）：12h・24h 1,039 / 1 / 108、72h 1,065 / 1 / 82、168h 1,078 / 1 / 69（止めた / 見逃した / 不明）。
- 停止率の区間：12h・24h 90.51%〜99.91%、72h 92.77%〜99.91%、168h 93.90%〜99.91%（下限＝不明を全部見逃し扱い）。
- v4 の再現：差分 0。
- 正直に書く：「全版を止める」ゲートは**未達**。不明が 108 / 82 / 69 残る。

### 4. 見逃した 1 件：@ensdomains/buffer 0.1.1
- GHSA-f9pq-63hg-w434（OSV では MAL-2025-190866 に取り込み）が 0.1.1 と 0.1.2 を悪性としている。
- registry の time：0.1.1 は 2023-02-28T09:46:00.601Z、0.1.2 は 2025-11-24T05:49:00.347Z。
- registry はもう配っていない → アーカイブで確認：
  - Software Heritage（2023-03-23 の visit、`swh:1:dir:3d9e48db08c991644ad0eba0475ca1fbd9ecc047`）と jsDelivr が同じ 21 ファイル・同じ sha256。
  - SWH の original artifact：sha1 `6c275ba7e457e935405b67876f1f0d980c8baa63`、284,259 bytes ＝ registry の shasum。
  - 0.1.0 と比べて `.js`・`.sol` はすべて同一。install script なし。
  - 悪性コード（`setup_bun.js`、`bun_environment.js`、`preinstall`）は 0.1.2 のみ。
- OSV の 3 つの出所のうち 0.1.1 を挙げるのは ghsa-malware だけ。

### 5. 「係争中」という分類を作った理由と、その限界
- 定義（引用）："A version named malicious for which the registry's hash and two independent archives (Software Heritage and jsDelivr, tied to that hash) show that its code equals the immediately preceding legitimate version's."
- 係争中も分母から外さない。ゲートの数字は変えない（ここが一番大事な姿勢）。
- **この分類は v4 の結果を見た後で作った**と明記する（README・definitions.md がそう書いている）。
- 係争中 2 件の漏斗：prev_d 未掲載 124、jsDelivr が V を持たない 12、package.json 照合失敗 988（CDN が 404）、コードが異なる 22、係争中 2。合計 1,148。
- 988 は「判定できなかった」であって「違う」ではない（CDN が削除済み版のファイルを配らない）。

### 6. もう 1 件の係争中：freo-design-system 1.0.4（教訓）
- 基準はすべて満たした（2026-10-28 の再確認）。だが 1.0.4 のコードは実際に外部へユーザー名とホスト名を送る。
- 係争中になった理由は、直前の 1.0.3（同一コード、preinstall 付き）が MAL-2025-3399 に載っていなかったから。
- 教訓：「直前版と同一」は「誤報」の証拠にもなるし「取りこぼし」の証拠にもなる。どちらかは中身を見ないと分からない。
- Ludion は 1.0.4 を全待機時間で止めている。
- （ossf/malicious-packages への追加依頼を送ったかどうかは、公開時点の事実に合わせて書く。現時点では下書き・未送信。）

### 7. 訂正依頼を出した
- 2026-10-28 23:09 JST に https://github.com/github/advisory-database/issues/10743 を提出。
- 依頼内容：affected から `= 0.1.1` を外し、`= 0.1.2` は残す。理由が公開データにないなら、その理由を advisory に書いてほしい。
- 証拠の限界も Issue に書いた：GitHub の分析者が何を見たかは分からない／SWH のローダーがチェックサムを検証したかは未確認。
- **ここは Issue の結果に合わせて書き直す節。**（受理・却下・理由の追記、いずれの場合も事実だけを書く）

### 8. 学んだこと
- 悪性リストも「正解データ」ではなく、誤りを含みうる入力として扱う。
- 証拠の基準を先に決めて commit する（後から都合よく基準を作らない。今回は v4 を見た後に作ったことを明記）。
- 複数の独立したアーカイブ（Software Heritage、jsDelivr）とハッシュの照合が効く。ただし削除済み版では jsDelivr はほぼ使えない（988 件）。
- 誤報の検出を運用（LS、シャドー運用）の項目に入れた。

### 9. おわりに
- 結果のデータとスクリプトの場所（repo のパス）。
- 間違いを見つけたら教えてほしい、という一文。

## 主要な事実と出典

| 事実 | 値（そのまま写し） | 出典 |
| --- | --- | --- |
| 悪性版の分母 | 1,148 | docs/bench/2026-10-28-backtest-v5/README.md、malicious-v5.json |
| 主結果 12h | 1,039 / 1 / 108 | 同 README、diagnostics/summary.txt |
| 主結果 24h | 1,039 / 1 / 108 | 同上 |
| 主結果 72h | 1,065 / 1 / 82 | 同上 |
| 主結果 168h | 1,078 / 1 / 69 | 同上 |
| 停止率区間 12h・24h | 1,039 / 1,148 = 90.51% 〜 1,147 / 1,148 = 99.91% | 同上 |
| 停止率区間 72h | 1,065 / 1,148 = 92.77% 〜 99.91% | 同上 |
| 停止率区間 168h | 1,078 / 1,148 = 93.90% 〜 99.91% | 同上 |
| v4 の下限 | 86.24% / 91.64% / 93.29% | 同 README |
| v4 再現の差分 | 0 | summary.txt "v4 reproduced differences: 0 []" |
| ゲート | 未達（with / without exception とも "not met"） | summary.txt |
| 係争中 | 2 件（@ensdomains/buffer 0.1.1、freo-design-system 1.0.4） | README "The disputed category" |
| 漏斗 | 124 / 12 / 988 / 22 / 2 | summary.txt "disputed funnel" |
| 実行時刻 | 2026-10-28T11:56:25Z〜12:55:30Z（20:56:25〜21:55:30 JST）、exit 0 | run-times.txt |
| SWH の待ち | 37 分と 15 分 | README |
| buffer 0.1.1 の sha1 | `6c275ba7e457e935405b67876f1f0d980c8baa63` | malicious-v5.json、ghsa-correction-request.md |
| buffer 0.1.1 の SWH ディレクトリ | `swh:1:dir:3d9e48db08c991644ad0eba0475ca1fbd9ecc047` | ghsa-correction-request.md |
| 訂正依頼 | https://github.com/github/advisory-database/issues/10743 、2026-10-28 23:09 JST 提出 | オーナーの記録 |
| PR | Ludion-ai/ludion #167（マージ 2026-10-28 22:32:03 JST、`51a8f0b`） | GitHub API |
| freo の分析 | `/workspace/ludion/ghsa/freo-design-system-1.0.4-analysis.md`（box 上、未 commit） | 本調査 |

## Issue が解決するまで書いてはいけないこと

- 「GitHub のデータベースは間違っている」「0.1.1 は安全／無害」と断定すること。言えるのは「公開データでは 0.1.1 のコードは 0.1.0 と同一で、install script がない」まで（v5 も "not that V is benign" と明記）。
- 「GitHub が誤りを認めた」「修正された」こと（実際に起きるまで）。
- GitHub の分析者の判断過程や原因の推測（なぜ 0.1.1 が入ったか）。
- Ludion の停止率を「99.91%」とだけ書くこと（上限であり、下限 90.51% とセットでしか書かない）。「誤りを除けば全部止めた」と書くこと（不明 108 / 82 / 69 が残り、ゲートは未達）。
- freo-design-system を「誤報」と書くこと（誤報ではない。取りこぼしの例）。
- freo の公開者の意図（バグバウンティかどうか）を断定すること。
- 送っていない依頼（freo の ossf への追加依頼）を「送った」と書くこと。
- Issue のコメントや GitHub 側の担当者の発言を、許可なく引用すること。

## メモ

- タイトルの「誤り」は Issue 解決前は断定に聞こえる。解決の内容次第で「誤りの可能性」などに変える。
- 公開はオーナーの判断。Issue #10743 が解決した後に判断する。
