# 事前登録：commander の excess arguments 修復（commander 12.1.0 → 13.0.0）

状態：事前登録（隔離実行の前に作成）。このファイルの sha256 を記録してから隔離実行を行う。数値はその隔離実行の結果だけから出す。

## 1. 目的

ロードマップのステップ2〜3で使う、開発専用の Verified Repair Capability 題材を1件固定する。

- この題材は `lessons/` にも本番 index にも入れない。既存 lesson を変換したものでもない。
- 当初は既存 lesson を1件変換する方針だったが、スコープ外のため、既存 lesson ではない題材にした。

## 2. 上流の変更

- パッケージ：`commander`（npm）
- 変更前：12.1.0（公開 2024-05-18T11:16:54Z UTC ＝ 2024-05-18 20:16 JST）
- 変更後：13.0.0（公開 2024-12-30T05:26:40Z UTC ＝ 2024-12-30 14:26 JST）
  - 公開日時は `npm view commander time --json` で確認した。
- 出典：https://github.com/tj/commander.js/blob/master/CHANGELOG.md#1300-2024-12-30
  - curl で取得して確認した（HTTP 200。raw 版 CHANGELOG.md の sha256 は `d22e40cad8a8214cdef32b2a7883136c4e69d01120527b41a3a3040e51f50234`、取得時点で CHANGELOG.md を最後に変えたコミットは `ba6d13ddb4243e5913367734f8c159089ffe7834`）。
  - 該当行（`## [13.0.0] (2024-12-30)` の `### Changed` にある行をそのまま引用）：

    > - \*Breaking\*: excess command-arguments cause an error by default, see migration tips ([#2223])

  - 同じ節の Migration Tips にある説明：

    > It is now an error for the user to specify more command-arguments than are expected. (`allowExcessArguments` is now false by default.)

- 要点：`allowExcessArguments` の既定値が true から false に変わった。13.0.0 では、宣言より多い command-argument を渡すとエラーになる。`.allowExcessArguments()` メソッドは 12.1.0 にもあるので、修正後のコードは両方の版で動く。

## 3. 再現手順（固定）

- runtime：Node 24（予備測定では v24.22.1 linux-x64 を使用）
- テストランナー：vitest 4.0.0
- vite は devDependency として 7.1.12 に固定する。vitest 4.0.0 は vite `^6.0.0 || ^7.0.0` を受け入れるため、固定しないとその時点の 7.x 最新（確認時点では 7.3.7）が入る。7.3.7 との非互換は予備調査の段階で報告されたが、未確認である（生ログはない）。
- package.json（隔離実行では正確な版に固定する。予備測定では `^12.1.0` などの範囲指定だった）：

  ```json
  {"type":"module","private":true,"dependencies":{"commander":"<12.1.0 または 13.0.0>","vitest":"4.0.0"},"devDependencies":{"vite":"7.1.12"}}
  ```

- パッケージは事前に取得しておき、コンテナはネットワークなし（network none）で実行する。
- 事前取得したパッケージのソースは、実行前に security reviewer がレビューする。
- recipient プログラム（修正前、`src/cli.js`）：

  ```js
  import { Command } from 'commander';
  export function run(argv) {
    const out = [];
    const p = new Command();
    p.exitOverride().configureOutput({ writeErr: () => {} });
    p.argument('<file>').action((f) => out.push(f));
    p.parse(argv, { from: 'user' });
    return out;
  }
  ```

  - `exitOverride()` を使い、プロセス終了ではなく例外にする。`configureOutput({ writeErr: () => {} })` で stderr への出力を止める。
  - commander 13 の他の破壊的変更は踏まないようにしている。サポート外の option flag は使わない。`storeOptionsAsProperties` は使わない。`.parse()` は1つのインスタンスにつき1回だけ呼ぶ（呼び出しごとに `new Command()` を作る）。`Help.wrap()` は使わない。
- 契約テスト（`test/cli.test.js`）：

  ```js
  import { test, expect } from 'vitest';
  import { run } from '../src/cli.js';
  test('extra args tolerated', () => { expect(run(['a.txt', 'extra'])).toEqual(['a.txt']); });
  ```

- 実行：`npx vitest run test/cli.test.js`。12.1.0 と 13.0.0 のそれぞれで、修正前と修正後の2通りを実行する（合計4通り）。

## 4. 期待結果

- 13.0.0・修正前：テストが失敗する。投げられる例外は `CommanderError: error: too many arguments. Expected 1 argument but got 2.`（`code` は `commander.excessArguments`）。
- codemod：`new Command()` から始まるチェーンに `.allowExcessArguments()` を差し込む（`new Command()` を代入した変数をレシーバとする呼び出しチェーンを含む）。予備測定の修正後ファイルは次のとおり：

  ```js
  p.allowExcessArguments().argument('<file>').action((f) => out.push(f));
  ```

- 13.0.0・修正後：テストが通る。
- 12.1.0：修正前も修正後もテストが通る（12.1.0 にも `.allowExcessArguments()` はあり、既定値は true）。

## 5. near-miss と期待結果

guard の判定は `applicable` / `inapplicable` / `unknown` / `stale` の4状態。

| # | 入力 | 期待する判定 |
|---|---|---|
| a | 余分な引数でエラーになることを期待するテスト（エラーになるのが契約） | 非該当（`inapplicable`）。書き換えない |
| b | 同じ commander 13.0.0 で `error: missing required argument 'name'`（`code` は `commander.missingArgument`）が出る場合 | 非該当（`inapplicable`） |
| c | ローカルで定義した `Command` クラスや、別ライブラリの `.parse()`（例：yargs） | 非該当（`inapplicable`） |
| d | commander 12.1.0 | 非該当（`inapplicable`）。既定値が true のため修復の必要がない |

## 6. guard の方針

- guard と allowlist は、この題材を変換して得たものだけを使う。
- 人が手で足したものは、すべて「手作業」として別に記録する。
- 既存の guard ルールは拡張も変更もしない。

## 7. 事前登録前の予備測定（開示）

この事前登録より前に、別の Linux マシンで予備の再現を1回行った。題材ごとに分けて開示する。時刻はすべて、そのマシン上のファイルの更新時刻（mtime、Asia/Tokyo）。

- 共通
  - 生ログ（stdout/stderr を保存したファイル）は残っていない。見つかったのは下記の作業ファイルだけ。結果の数値はここには書かない。
  - vitest の作業プロジェクトは1つで、commander・zod・nanoid の3題材を同居させていた（`test/cli.test.js`、`test/zod.test.js`、`test/id.test.js`。修正前のソースは `src.orig/`、修正後は `src/`）。最後のインストール状態は commander 12.1.0 / zod 3.25.76 / nanoid 4.0.2 / vitest 4.0.0 / vite 7.1.12（package.json と lockfile の mtime は 2026-10-25 15:15:00 JST）。どの版の組み合わせで何回実行したかを示すファイルは残っていない。
  - Node 24.22.1 の取得：2026-10-25 15:13:39 JST
- commander
  - commander 12.1.0 と 13.0.0 を別々のディレクトリに入れた：2026-10-25 15:13:42 JST
  - 単体確認スクリプト（余分な引数でのエラー、`.allowExcessArguments()` での回避、missing argument の確認）：2026-10-25 15:14:05 JST
  - サブコマンドと引数なしの確認スクリプト：2026-10-25 15:15:15 JST
  - 契約テスト `test/cli.test.js`：2026-10-25 15:14:38 JST（sha256 `197b0b1a64cbb3f32be3fb7f75e588c9bb6dbf831d9d8f5e513ebfb64f92e919`）
  - 修正前 `src.orig/cli.js`：2026-10-25 15:14:59 JST（sha256 `1d7aca92554aa6cb96cb3044449c4532eaee5ad67228b224a1a421f3d9922755`）
  - 修正後 `src/cli.js`：2026-10-25 15:15:01 JST（sha256 `2f84ca52deb9a211212cd88ac7454b11209de20054654f587047a25ec0f41a84`）
- zod（採用取り下げ。第8節を参照）
  - zod 4.0.0 / 3.25.76 / 3.22.4 を別々のディレクトリに入れた：2026-10-25 15:13:41〜15:13:42 JST
  - 単体確認スクリプト（`.errors` の有無など）：2026-10-25 15:13:50 JST
  - サブパス（`zod/v3`・`zod/v4`）の確認スクリプト：2026-10-25 15:15:15 JST
  - 契約テスト・修正前・修正後のファイルは、commander と同じ作業プロジェクト内にある（mtime はそれぞれ 15:14:38 / 15:14:59 / 15:15:01 JST）。修正後のファイルには `.errors` → `.issues` のほかに、`z.record` の引数を2つにする変更も入っていた。
- nanoid（予備候補）
  - nanoid 4.0.2 と 5.0.0 を別々のディレクトリに入れた：2026-10-25 15:13:45 JST
  - 単体確認スクリプト（`nanoid/async` の import）：2026-10-25 15:14:05 JST
  - 契約テスト・修正前・修正後のファイルは、commander と同じ作業プロジェクト内にある（mtime は commander と同じ）。

数値は、このファイルの hash を記録した後に行う隔離実行の結果だけから出す。予備測定の値は参考扱いとし、結果には使わない。

## 8. 試した候補（13件）

- 採用：commander 12.1.0 → 13.0.0（`allowExcessArguments` の既定値が true から false に変わった）
- 予備候補：nanoid 4.0.2 → 5.0.0（`nanoid/async` の削除）
- 取り下げ：zod 3.25.76 → 4.0.0（スコープ外のため）
  - commander は、どの結果も出る前に予備候補として名前を挙げていた。結果を見てから選び直したものではない。
- 不採用（理由つき）
  1. date-fns 2.30 → 3.0：前提が成り立たない。3.0 では ESM の default が動き、2.30 は ESM のディレクトリ import で失敗する。
  2. uuid 7 → 8：旧版のベースラインが ESM の deep import で失敗する。変更自体も2020年のもの。
  3. chalk 4 → 5：Node 24 の require(esm) で失敗の形が変わる。TTY に依存し、結果が不安定。
  4. ajv 6 → 8：値の形式も変わるので、純粋な名前変更ではない。
  5. glob 8 → 9：変更が複数あり、ファイルシステムに依存する。
  6. execa：子プロセスを起動する。
  7. undici：ネットワークが必要。
  8. dotenv 17：ログ出力の既定値が変わっただけで、テストは失敗しない。
  9. pino：非同期の worker transport を使うので、結果が不安定。
  10. minimatch 5 → 6：有望だが未検証。

## 9. 公開文書の書き方

この文書には、内部の役割名や PC 上のパスを書かない。レビュー担当は「technical reviewer」「security reviewer」と書く。
