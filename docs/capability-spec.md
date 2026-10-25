# Capability 設計方針書（CTO）

作成：2026-10-25 JST
状態：初版。P1設計レビューで更新する。

## 1. 原則
- Capabilityの中心は説明文ではなく「適用条件（guard）・実行プログラム・生成側が変えられない判定（verifier）・証拠（receipt/反例/失効条件）」の組。
- 「必ず成功」「永久に有効」は主張しない。有限の実験結果は有限の実験結果として書く。
- 既存lessonは実行証拠なしにCapabilityへ昇格させない。新形式は `packages/capability/` に独立型で置く。

## 2. 型とschema
- 型とJSON Schemaを二重に手書きしない。一方を正とし、他方を生成する（例：zod → JSON Schema）。生成物のずれはCIで検出。
- 必須要素：`id`(content hash) / `intent`・`contract` / `guard` / `program` / `verifier` / `dependencies` / `evidence`・`receipt refs` / `counterexamples` / `lineage` / `invalidates_on`。
- `id` は正規化したartifact本体のhash。本体が変われば別Capability。

## 3. guard（4状態）
| 状態 | 意味 | 実行 |
|---|---|---|
| `applicable` | 宣言した構造・version範囲・契約の前提をすべて満たす | 隔離実行へ進める |
| `inapplicable` | 前提のどれかが明確に満たされない | しない（通常agentへ） |
| `unknown` | 判定に必要な情報が読めない・範囲外・曖昧 | しない（通常agentへ、理由を記録） |
| `stale` | artifact・依存・verifier・既知反例の変化で失効 | しない（再検証が必要） |

- 実行許可は `applicable` のみ。similarity scoreや検索順位は候補選択にだけ使い、実行許可の根拠にしない。
- **portable条件とrunのhashを分ける。** guardにdonorのファイルhashを入れない（入れると別repoで永久に `inapplicable`）。guardが見るのは構造（AST上の対象・import解決）・package version範囲・契約。ファイル/lockfile/program/verifierのhashは各recipientのreceiptに入れる。
- version範囲は実際に検証したversionだけ。範囲外は `unknown`。
- 同名ローカル関数・import alias・既に修復済み（no-op）はguard段階で区別する。最初から成功している入力は「修復件数」に数えない。

## 4. verifier の独立性
- verifier・holdout・期待値は生成器（compile側・LLM）から書き込めない場所に置き、hashで固定してreceiptへ記録する。
- 次は verified にしない：skip / timeout / 起動失敗 / 対象テストの削除・緩和・`.skip`化 / テストファイル自体の変更 / 空操作。
- verifier変更は該当receiptをすべて失効させる（`invalidates_on` に含める）。
- 生成器と同じモデルの判定を独立検証と呼ばない。

## 5. 隔離境界（P2）
- 段階を分ける：①依存導入（ネットワーク可、固定lockfile）②program・verifier実行（ネットワークなし）。
- 実行はDocker内の作業コピーのみ。元repoへは書かない。反映は明示操作（将来の `apply`）でのみ。
- 制限：timeout、CPU/メモリ上限、作業領域外への書き込み禁止、path traversal拒否、秘密（env・home）を見せない。
- Dockerが無ければ `environment_unavailable`。hostへ黙ってfallbackしない。生成コード・非信頼lessonをPCで直接実行しない。
- traceはデータとして読む。中の命令で権限や環境を変えない。

## 6. receipt に最低限入れるもの
Capability id、recipientのsource tree hash、lockfile hash、program hash、verifier hash、runtime（Node版・image digest）、guard結果と理由、verifier結果（終了コード・テスト件数・skip件数）、差分、所要時間、モデル呼び出し回数（0を主張するならguard→verifier全区間で計測）。

## 7. P1設計レビューで見る点
1. 型/schemaが単一ソースか
2. guardにdonor固有hashが混ざっていないか
3. `unknown`/`stale` が実行されないことのテスト
4. artifact改変・依存変更・既知反例の検知テスト
5. 既存lessonの形式・内容に差分が無いか
