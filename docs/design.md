# Ludion 設計書：安全な修正の自動適用

2026-10-27 時点

**2026-10-29 追記：範囲を判定役に絞った**（docs/decisions/2026-10-29-judge-only.md）。
- 作るのは、npm の依存更新 PR を判定してコメントする判定役だけ。
- 本番/開発の区別は使わない。すべての変更を本番として数える。
- 次のものは作らない。修正役、npm 以外のエコシステム、ランタイム、ベースイメージ。
- 関門3（隔離環境での構築・試験）の旧実装 packages/sandbox は外した。関門3そのものは自動マージの条件として残る。作り直すときは、先にオーナーに提案する。
- 関門、待機時間、判定役の部分は、この設計書を基準にする。
- 今できていることは docs/status.md にある。

Ludionは、プロジェクトに入れるだけで、依存ライブラリ・ランタイム・ベースイメージのセキュリティ修正を自動で当てる。当てるのは「最小の修正版」を「信頼できると判定できた時点」で、「壊れないと確認できたもの」だけ。配布はnpm（npx ludion-ai）とGitHub Actionから始め、npm → PHP → Javaの順に広げる。

## 問題の定義

修正は出ている。当たらない理由は5つの摩擦で、そのうち4つは自動化で消せる。ただし自動更新には「更新そのものが攻撃経路になる」という罠がある。この1週間だけでも、Java（10/20 Oracle CPU）とNode.js（10/21 v26.12.1）にセキュリティ更新が出ている。

| 時期 | 事例 | 設計への教訓 |
| --- | --- | --- |
| 2025-11-21〜23 | [Shai-Hulud 2.0](https://blog.checkpoint.com/research/shai-hulud-2-0-inside-the-second-coming-the-most-aggressive-npm-supply-chain-attack-of-2025/)（npm）。preinstallで認証情報を盗み、盗んだトークンで自己増殖。621パッケージ、約2.5万リポジトリ | 取り込んだ瞬間にコードが動く。検証は秘密情報の無い場所でしか行わない |
| 2025年通年 | [Log4Shell](https://www.infosecurity-magazine.com/news/log4shell-downloaded-40-million/)。Log4jのダウンロードの13%（4,000万回）がまだ脆弱版 | 修正から4年経っても古い版が選ばれ続ける。人の注意には頼れない |
| 2025-09-08 | [chalk・debug等](https://semgrep.dev/blog/2025/chalk-debug-and-color-on-npm-compromised-in-new-supply-chain-attack)（合計週26億DL）がフィッシングで乗っ取られ悪性版を公開。多くは1時間以内、duckdbは7〜9時間で除去 | 数時間〜1日待てば大半の悪性版は避けられる |
| 2025-01〜 | [CVE-2024-4577](https://blog.talosintelligence.com/new-persistent-attacks-japan/)（Windows上のPHP-CGI）で日本の組織が侵入される。修正公開（2024-06-06）から7か月後 | 知らなければ修正は永遠に当たらない |

五つの摩擦と、Ludionが消すもの:

1. **知らない** → 公式情報（OSV・各公式リリース）を常時照合する。
2. **関係あるか分からない** → 本番で読み込まれるか、該当条件に合うかで絞る。通知を減らすこと自体が機能。
3. **壊れるのが怖い** → 旧版と新版を同じ隔離環境で比べ、依存の公開APIの差分も出す。
4. **手間がかかる** → 最小の修正を自動で作り、条件を満たせば自動で取り込む。
5. **直す版が無い**（サポート終了・メジャー更新が必要）→ 自動では当てない。移行計画を出す。PHPサイトの34%以上はPHP 7以下で、公式パッチはもう出ない（[W3Techs](https://w3techs.com/technologies/details/pl-PHP)、2026-10-26時点）。

Ludionの目的は一つに絞る。**修正が公開されてから本番の構成に入るまでの時間（露出時間）と、そのための人の作業を、供給網リスクを増やさずに最小化する。**

## 既存ツールとの差

既存ツールは「更新PRを作る」ところまでは満たしている。空いているのは、**そのPRを取り込んで安全かを、証拠つきで判定して自動で取り込む**部分だ。

| ツール | やること | 待機時間 | 更新そのものの検査 | 取り込み判断 |
| --- | --- | --- | --- | --- |
| [Dependabot](https://docs.github.com/en/enterprise-cloud@latest/code-security/concepts/supply-chain-security/about-dependabot-security-updates) | 脆弱性を直す「最小の版」へのPR。GitHub専用 | 通常更新は既定3日。**セキュリティ更新は即時**（[2026-07-14変更](https://github.blog/changelog/2026-07-14-dependabot-version-updates-introduce-default-package-cooldown/)） | 悪性パッケージの警告（任意で有効化、警告のみ）。他の公開リポジトリのCI結果から互換性スコア | 人か、自分で書いた自動マージ |
| [Renovate](https://docs.renovatebot.com/merge-confidence/) | ほぼあらゆる依存・バージョン指定を更新。どこでも動く | minimumReleaseAgeで設定 | なし。Merge Confidence（経過日数・採用率・テスト成功率）、算出法は非公開 | 通常の自動マージは無料。Merge Confidenceを使う自動マージは有料プランかOSS向けクラウド |
| [pnpm](https://pnpm.io/settings/dependency-resolution) | インストール時の防御（更新はしない） | minimumReleaseAge 既定1,440分 | trustPolicy: no-downgrade（前の版より信頼レベルが下がったら失敗） | 対象外 |
| **Ludion** | 修正を作る＋誰かの更新PRを判定する。依存・ランタイム・ベースイメージ | 緊急度と信頼の証拠で変える（12時間〜7日） | 来歴の後退・公開者の変化・新しいインストールスクリプト・新しい依存・悪性DBを、差分の全パッケージに | 四つの関門を通れば自動。理由はレシートに残す |

**競合しない。後ろに立つ。** 個人開発者はもうDependabotのPRに埋もれている。LudionはそのPRを判定して、安全なものだけ自動で取り込む。そのうえで、Dependabotが扱わないもの（ランタイムのバージョン指定、ベースイメージ、親が固定している推移依存、GitHub以外）は自分で修正を作る。

**なぜ今か。** npmのtrusted publishingが[2025-07-31に一般提供](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/)され、来歴証明が自動で付くようになった。OSVは悪性パッケージをMAL-のIDで[同じAPIから返す](https://openssf.org/?p=11003)。「更新の出所が前の版と同じか」を機械で確かめる材料が、ようやく揃い始めた。ただし出所が同じでも、中身が安全とは限らない（関門2の限界は次の節）。業界は「待つ」が効くと学んだが、まだ経過日数だけの粗い待ち方しかしていない。

## 「安全」の定義

安全とは、次の四つの関門をすべて通ることだと定義する。一つでも判定できなければ、自動では当てない（判定不能＝停止）。

1. **当てはまるか**：脆弱な範囲に入っているか。本番で読み込まれる依存か（開発・テスト専用は優先度を下げるだけで、無視はしない）。該当条件（OS・SAPI・設定）に合うか。CVE-2024-4577はWindows上のCGI構成にしか刺さらない。
2. **本物か**：公式レジストリ・公式イメージからハッシュ固定で取得する。次のどれかが出たら停止する。
   - 前の版にあった来歴証明（provenance）が消えた、またはリポジトリ・ワークフローが変わった
   - インストール時に動くスクリプト（preinstall・install・postinstall）が新しく増えた
   - OSVの悪性記録（MAL-）に該当した、または非推奨化・取り下げされた

   次の場合は止めずに待機を延ばし、人に知らせる。公開者が変わった（トークン公開からtrusted publishingへ移っただけでも変わる）。依存が新しく増えた。差分に難読化や、新しい通信・プロセス起動が加わった。
3. **壊れないか**：隔離環境で旧版と新版を同じ条件でビルド・テストし、旧版で通るテストが新版でも全部通ること。旧版で何も通らない場合と、変わったパッケージが実際に読み込めると確かめられない場合は、判定不能にする。テストが無くても、依存の公開API（型定義、jarのバイナリ互換）の差分と、自分のコードが使っている箇所の交わりで補う。インストールスクリプトが必要なパッケージは、秘密情報の無い隔離環境の中でだけスクリプトを許す。
4. **戻せるか**：1修正＝1コミット（またはPR）。ロックファイルはハッシュ固定。壊れたらrevert一回で戻せる。ただし悪性版が秘密情報のある場所（利用者のCIや本番）で一度でも動いた後の被害は、revertでは戻らない。だから関門2と待機時間を先に置く。

関門2の検査対象は、狙った1パッケージではない。**ロックファイル差分に現れた全パッケージ**だ。修正のついでに無関係なパッケージが最新版へ動き、そこに悪性版が混ざるのが一番ありふれた事故になる。

**関門2が見逃すもの。** 前の版にも来歴証明が無いパッケージで、正規の公開者アカウントが乗っ取られ、既存のファイルに悪性コードが入った場合（chalk・debugの手口）は、停止条件のどれにも当たらない。差分の難読化で待機が延びることはあっても、確実ではない。確実に効くのは、待機時間と、待機が明けた時点の再照会（MAL-・非推奨化・取り下げ）だ。待つ意味はこの再照会にある。

自動適用の条件はこう書ける。Gは四つの関門、uは緊急度、w(u)は待機時間、t\_publish,iは差分で変わる各パッケージの公開時刻（一番新しいものが基準）。G2には、待機が明けた時点で照会し直した結果を使う。

```latex
\text{auto-apply} \iff G_1 \land G_2 \land G_3 \land G_4 \land \left( t_{\text{now}} - \max_i t_{\text{publish},i} \ge w(u) \right)
```

待つほど悪性版を避けられ、待つほど脆弱なまま晒される。悪用が確認された脆弱性だけは、待つ損の方が大きい。以下は初期値で、「ロードマップと検証ゲート」のバックテストで調整する。

| 緊急度 | 条件 | 待機時間 w | 動き |
| --- | --- | --- | --- |
| 最優先 | CISA KEV掲載など、悪用が確認されている | 12時間（来歴を前の版と比べられる場合のみ。比べられなければ24時間） | 自動適用＋即時通知 |
| 高 | 重大度Criticalまたは悪用予測（EPSS）が高い、本番依存 | 24時間 | 自動適用 |
| 通常 | 本番依存のその他 | 72時間 | 自動適用（設定でPR止まり） |
| 低 | 開発・テスト専用 | 7日、週1回まとめる | まとめPR |
| 停止 | 関門2の停止条件に一つでも該当 | — | 自動では当てない。理由を添えて人に渡す |

根拠。chalk・debugの悪性版の多くは1時間以内に消えた。duckdbの悪性版は7〜9時間後に非推奨化されたが、非推奨化だけではインストールは止まらない。だから非推奨化も停止条件にし、最優先でも12時間待つ。

Shai-Hulud 2.0の波は3日間続いた。これは攻撃全体の期間で、各版が見つかるまでの時間ではない。通常の72時間は、この規模の波が収まるのを待つ値として置き、バックテストで確かめる。

表の「自動適用」は、applyをauto-mergeにした場合の動き。既定ではPRを開くところで止まる。プロジェクト自身の設定（pnpmのminimumReleaseAgeなど）の方が厳しければ、そちらに従う。

## アーキテクチャ

中核は「ロックファイル差分を受け取り、当ててよいかを判定する」関数一つだ。判定役は既存PRから差分を得て、修正役は自分で差分を作る。その先の判定・隔離実行・記録は、全エコシステムで同じコードを通る。

```text
[判定役] 既存の更新PR（Dependabot/Renovate/人）    [修正役] 在庫→照合（OSV）→最小修正を計画
                 \                                     /
                  →  [ロックファイル差分（変わる全パッケージ）]  ←
[エコシステム別アダプタ: 在庫・当て方・検証]   [データ源: OSV(脆弱性・MAL-)・KEV・EPSS・レジストリの来歴/公開時刻・公式リリース]
                                   ↓
[判定（全エコシステム共通）]
   1 当てはまるか / 2 本物か / 3 壊れないか / 4 戻せるか
   待機時間 w(u)：最優先12h・高24h・通常72h・低7日（明けたら関門2を再照会）
     ↓ 全関門合格＋待機済み               ↓ 一つでも不合格・判定不能
   [自動で適用（コミット/PR/マージ）]     [人に渡す（理由と移行計画）]
                     ↘                   ↙
        [レシート：根拠と露出時間（修正公開→検知→適用）]
```

エコシステムごとに差し替えるのは、次のインターフェースだけ。関門・待機時間・レシートはアダプタを知らない。

```ts
interface Adapter {
  detect(root: string): boolean;
  inventory(root: string): Package[];             // 解決済みの版と、本番/開発の区別
  plan(finding: Finding): Change | Blocked;       // 最小の修正版と、その当て方
  apply(change: Change, box: Sandbox): LockDiff;  // 対象パッケージだけ動かす。スクリプト無効
  validate(): Command[];                          // 旧版・新版の両方で走らせるコマンド
  apiDiff?(from: Artifact, to: Artifact): ApiChange[]; // .d.ts・japicmp など
}
```

隔離環境は二段階にする。取得段階は、公式レジストリだけにつなぎ、インストールスクリプトは無効。実行段階は、ネットワーク無し・読み取り専用・非root・秘密情報なし。現行のPHP検証がすでにこの形なので、それを全エコシステムへ広げる。

## 導入体験

個人開発者がやることは `npx ludion-ai init` を1回実行するだけ。そこから先、Ludionは二つの役で動く。

- **判定役**：Dependabot・Renovate・人が作った依存更新PRを、四つの関門で判定してコメントで返す。条件を満たし、設定で許可されていれば取り込む（既定はPR止まり）。
- **修正役**：誰も扱わない修正（ランタイムのバージョン指定、ベースイメージ、親が固定している推移依存、悪用確認済みの緊急修正）を自分で作り、同じ判定を通してPRにする。

初回の出力。件数を絞ることが、そのまま価値になる。

```text
$ npx ludion-ai init
検出: npm（package-lock.json）、Dockerfile（node:22.11.0-slim）
作成: ludion.json、.github/workflows/ludion.yml（アクションはコミットSHAで固定）

本番に関係する脆弱性: 2件
  自動で直せる  1件（待機中、あと19時間）
  判断が必要    1件（修正はメジャー更新のみ → 移行計画を作成）
表示を省略: 14件（開発専用 9、該当条件外 5）— 全件は npx ludion-ai scan --all
```

PRに載る判定。理由と露出時間を毎回残す。

```text
Ludion 判定: 自動マージ可
example-lib 2.3.4 → 2.3.5（GHSA-xxxx-xxxx-xxxx、本番依存、緊急度: 高）
  当てはまるか  ✓ 本番依存、脆弱範囲 >=2.0.0 <2.3.5
  本物か        ✓ 来歴証明あり（前の版と同じリポジトリ・ワークフロー）、公開者同じ、
                  新しいスクリプトなし、新しい依存なし、MAL該当なし・非推奨化なし（待機明けに再照会）、公開から26時間
  壊れないか    ✓ テスト 旧版41/41 → 新版41/41、公開APIの差分なし
  戻せるか      ✓ package-lock.json のみ（変わったパッケージ2つ、両方検査済み）
露出時間: 修正公開 10/21 03:00 → 検知 03:40 → 適用 10/22 05:10（26時10分）
```

設定は `ludion.json` 一つ。無設定でも動き、initが書く初期値はこうなる。

```json
{
  "schema": 2,
  "apply": "pr",
  "majors": "plan-only",
  "cooldown": { "exploited": "12h", "high": "24h", "normal": "72h", "low": "7d" },
  "test": ["npm", "test"],
  "sandbox": "ci",
  "ignore": [{ "id": "GHSA-xxxx-xxxx-xxxx", "reason": "該当機能を使っていない", "until": "2026-12-31" }]
}
```

- `apply` は pr・auto-merge・commit・off。最初はPR止まりで始め、判定の実績が溜まったらLudionが auto-merge を提案する。
- `ignore` には理由と期限が必須。永久に黙らせる方法は作らない。
- `sandbox` は ci（Actionsの使い捨て環境）か docker（手元）。候補のコードを開発者のマシン上で直接動かす選択肢は無い。

GitHub Actionsでは権限を2つのジョブに分ける。

1. **検証ジョブ**：読み取り権限のみ、秘密情報なし。候補をネットワーク無しのコンテナでビルド・テストし、結果（終了コードとログ）だけを成果物にする。この出力は、候補のコードに書き換えられうる前提で扱う。
2. **適用ジョブ**：書き込み権限あり。依存のコードを一切実行しない。関門1・2・4と差分のハッシュはここで計算し直し、マージ直前にMAL-・非推奨化・取り下げを照会し直す。PRの最新コミットが検証したものと同じときだけマージする。

**トークン。** 修正PRの作成とマージは、利用者がインストールするGitHub Appのトークンで行う。GITHUB\_TOKENで開いたPRは、CIが[承認待ち](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)で止まる。

**マージの方法。** GitHubの自動マージ機能は、GitHub Freeの非公開リポジトリでは[使えない](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request)。だから、検証したコミットSHAを指定してマージAPIを呼ぶ。headが変わっていればマージは失敗する。

実行間隔。GitHub Freeの非公開リポジトリは月[2,000分](https://docs.github.com/en/billing/concepts/product-billing/github-actions)、公開リポジトリは無料。既定は非公開が6時間ごと、公開が1時間ごと。重い検証は候補があるときだけ走らせる。GitHub以外では `npx ludion-ai scan | fix | watch` を手元で使う。Dockerが無い環境では関門3を飛ばしたことを明示し、自動適用はしない。

公開リポジトリの定期実行は、60日間活動が無いと[自動で止まる](https://docs.github.com/en/enterprise-server@3.5/actions/using-workflows/disabling-and-enabling-a-workflow)。放置されたプロジェクトほど止まるので、将来はGitHub App側から起動する。

## エコシステム別の設計

読み取り（scan）は最初から全エコシステムで出す。自動適用は npm → PHP → Java → Python の順に解禁する。各エコシステムが差し替えるのは、下の4列だけ。

| 対象 | 在庫（何を読むか） | 最小修正の当て方 | 本物かの手がかり | 壊れないかの手がかり |
| --- | --- | --- | --- | --- |
| npm | package-lock・pnpm-lock・yarn.lockの解決済み版と本番/開発の区別。.node-version・.nvmrc | 直接依存はpackage.jsonの範囲の書き方（^・\~）を保ったまま下限だけ上げ、`npm install --package-lock-only --ignore-scripts`。推移依存は親の範囲内なら対象だけ更新、範囲外なら overrides | 来歴証明（SLSA）の継続、公開者、installスクリプト、新規依存、MAL- | 隔離環境で `npm ci --ignore-scripts` → テスト・型検査・ビルド。型定義（.d.ts）と exports の差分 |
| PHP | composer.lock、Dockerfileの `php:x.y.z` | `composer update vendor/pkg:x.y.z --minimal-changes --no-scripts --no-plugins`。ランタイムは同じブランチのセキュリティリリース（実装済み） | 配布アーカイブのコミット固定とチェックサム、MAL-。ランタイムはphp.netの公式メタデータと公式イメージのダイジェスト | オフラインで install → PHPUnit・スモークテスト。公開クラス・メソッドの差分は後日 |
| Java | Mavenの解決済み依存ツリー、Gradleのロックファイル。JDKは .java-version・toolchains・`eclipse-temurin` タグ | 直接依存は version 更新、推移依存は dependencyManagement（Gradleは constraints）。BOM管理ならBOMを上げる | 署名鍵が前の版と同じか、Sigstore署名（Maven Centralは2025-01-28から検証）、MAL-。Mavenは既定では署名を検証せず、チェックサムも同じサーバーから来るので、それだけでは足りない。JDKは公式配布の更新情報（Oracle CPUの直近は[2026-10-20](https://www.oracle.com/java/technologies/javase/26-0-2-1-relnotes.html)） | 事前取得のうえオフラインで `mvn -o verify`・`gradle build --offline`。[japicmp](https://github.com/siom79/japicmp)でjarのバイナリ互換・ソース互換 |
| Python | uv.lock・poetry.lock・固定済み requirements | 対象パッケージだけ上げる（例 `uv lock --upgrade-package 'pkg==x.y.z'`） | PyPIのPEP 740 attestation（来歴証明）、MAL- | wheelだけ取得し、sdistのビルドスクリプトを動かさない → pytest |
| ベースイメージ | DockerfileのFROM（タグ＋ダイジェスト） | 同じブランチの新しいタグにしてダイジェスト固定（PHPで実装済みの方式を一般化） | 公式イメージのダイジェスト | 新旧イメージでビルド・テスト |

ランタイムは公式情報で「セキュリティリリースかどうか」を判定できる。Node.jsは[配布一覧](https://nodejs.org/dist/index.json)の各版に `security` フラグがあり、v26.12.1（2026-10-21）は true。PHPはphp.netのリリース情報、JavaはOracle・Adoptiumの更新情報を使う。

npmを最初にする理由は四つある。個人開発者が一番多い。来歴証明の仕組みが一番整っている。供給網攻撃が一番多い。既存ブランチに土台がある。

既存ブランチ（`security/multi-ecosystem`）で直す点:

- 候補の生成が `npm update` と `composer update --with-all-dependencies` をパッケージ名なしで実行している。これでは全依存が動き、最小修正に反する。無関係な新版（悪性版かもしれない）を取り込む入口にもなる。対象パッケージに限定する。
- 自動修正が package-lock.json 専用。個人開発者には pnpm 利用者が多いので、pnpm-lock の修正を次に入れる。
- 取得元の制限（registry.npmjs.org のみ等）はあるが、待機時間と、来歴・公開者・スクリプトの検査は未実装。ここが製品の芯なので最優先で作る。

## Ludion自身を攻撃経路にしない

自動更新ツールは、乗っ取られれば全利用者のCIで書き込み権限つきで動く。Ludion自身が一番狙われる依存になるので、次の7つを規則にする。

- **トークンを持たない**：公開はtrusted publishing（OIDC）だけ。npmトークンも手動公開もやめる。来歴証明は自動で付く。
- **依存を持たない**：実行時依存ゼロ（1ファイルにバンドル）、インストールスクリプトなし。公開中の ludion-ai 0.1.4 は来歴証明付き・実行時依存ゼロなので、これを崩さない。
- **利用者側で固定させる**：initが書くworkflowは、ActionをコミットSHAで固定し、CLIはActionに同梱する（SHAでコードまで固定される）。手元ではnpxではなく開発依存として入れ、ロックファイルのintegrityで固定する。
- **自分にも同じ規則を当てる**：Ludion自身の更新も、待機時間と来歴の継続チェックを通す。そのうえで自動マージはしない。新しい版が自分自身を判定してマージする循環になるので、必ず人が見る。
- **権限を分ける**：候補を実行するジョブは書き込み権限も秘密情報も持たない。書き込むジョブは依存のコードを実行しない。
- **バイトを配らない**：Ludionは公式レジストリと公式イメージを指し、ハッシュで固定するだけ。中継サーバーも独自ミラーも持たない。最初の版はサーバー無しで、データは各公式APIから直接取る。
- **送らない**：OSVへ送るのはパッケージ名とバージョンだけ。ソースコードも利用状況も送らない。

## 掃除計画

セキュリティ機能が旧コードから使っているのは2ファイルだけだ。それ以外の約1万行は、タグで凍結してmainから消す。旧CLI（ludion-ai 0.1.x）のダウンロードは10/5以降の累計511回で、うち460回は公開日の10/11〜12。10/13以降は15日で38回しかない。互換を守る相手は実質いない。

| 対象 | 判断 | 理由 |
| --- | --- | --- |
| packages/cli/src/security/、lockfile.ts | 残す | 新製品の本体 |
| capability/src/executor.ts の createDockerRunner、tools/verify/src/docker.ts の runDockerImageCommand・buildDockerRunArgs | 必要な関数だけ新しい packages/sandbox へ抜き出す | 2ファイルで計2,172行あり、能力スキーマやレッスン用イメージ表など旧部品を引きずっている |
| tools/verify/src/safe-fetch.ts | sandbox へ移す | 私的ネットワークへの接続を拒むfetch。レジストリ取得に使える |
| packages/capability（残り）、packages/core | 消す | v3の能力記述と、レッスンのスキーマ・検索 |
| CLIの sync・teach（ledger・match・publish・render・shards・teach.ts） | 消す | 旧製品のコマンド |
| tools/seed、tools/bench、tools/verify（抜き出し後の残り） | 消す | レッスンの生成・ベンチ・検証 |
| lessons/（62ファイル）、LICENSE-LESSONS、plugin/、.claude-plugin/ | 消す | レッスンのデータとClaude Code用プラグイン |
| apps/worker の /mcp と /index/\* | 終了を告げる固定応答に置き換え、90日後に削除 | 古い設定から呼ばれても理由が分かる |
| apps/site | 残して中身を差し替える | デザイン、アクセシビリティ試験、配信経路は資産 |
| docs/（decisions.mdとprogress.md以外）、video/ | 消す | 旧製品の測定記録。docs全体で63MBある |
| workflow：reverify・seed-watch・verify | 消す | レッスン用 |
| workflow：test・deploy・publish・protected-paths | 残す | 手直しして使う。deployはreverifyの失敗リストを読む手順を、testはレッスン見本のビルドを外す |
| CLAUDE.md | 書き直す | 「旧コマンドと旧エンドポイントの互換を保つ」という約束を外す |

手順。CLAUDE.mdの規則で、保護パス（.github/、tools/verify/、lessons/、CLAUDE.mdなど）を触るPRは新しい文脈のレビューとオーナーのマージが要る。

1. `security/multi-ecosystem` をpushする。作業していたworktreeはもう無く、このブランチのコミットは手元にしかない。
2. 今のmainに `archive/lessons-2026-10-27` タグを付けてpushする。削除はこれで取り消せる。
3. PR-A：ブランチをmainへ。最小修正の件は次のPRで直す。
4. PR-B：packages/sandbox の抜き出し（保護パスあり）。
5. PR-C：旧コード・データ・workflowの削除（保護パスあり）。
6. PR-D：workerの終了応答、サイトの文言、CLAUDE.md（保護パスあり）。
7. `npm deprecate` で 0.1.x に終了を告知し、次の公開から同じ名前を新製品に使う。

レッスンの仕組み（変更点を一次情報と差分テストで検証する）は、将来のメジャー更新の自動移行で使える可能性がある。だから捨てるのではなく、タグで凍結する。

## ロードマップと検証ゲート

8週間でnpm・PHP・Javaの自動適用まで進める。各段階の終わりに数字のゲートを置き、満たさなければ次へ進まない。

| 期間 | 段階 | 内容 | 次へ進む条件（ゲート、提案値） |
| --- | --- | --- | --- |
| 第0週 10/28〜11/1 | 掃除 | ブランチをpush、旧コードをタグで凍結して削除、packages/sandbox抜き出し、CLAUDE.md更新 | テスト・型検査・セキュリティ試験が全部緑 |
| 第1〜2週 11/2〜11/15 | 判定役 v0（npm） | 四つの関門と待機時間。判定はコメントのみ。並行してバックテストとノイズ測定 | 既知の悪性リリースを全部止める／本物の修正の遅延中央値24h以内／通知3分の1以下 |
| 第3〜4週 11/16〜11/29 | 自動マージと修正役（npm） | ランタイム指定・ベースイメージの修正、npx ludion-ai init、個人開発者5人で試用 | 5人×2週間で壊れた自動マージ0件・人の作業 週5分以下 |
| 第5〜8週 11/30〜12/27 | PHPとJavaを自動適用まで | Composer・PHPランタイム・Maven/Gradle・JDK、japicmp | 実リポジトリで露出時間の中央値72h以内 |
| 2027年1月〜 | 広げる | Python、サーバー常駐エージェント（読み取り専用から）、メジャー更新の移行支援、保守会社向け一括管理 | — |

ゲートで測るもの（数字は提案値）:

1. **バックテスト**：2025年の既知の悪性リリース（chalk・debug群、duckdb、Shai-Hulud群など。OSVのMAL-記録から抽出）について、当時のレジストリ情報だけで関門2と待機時間が自動適用を止めたかを再現する。削除済みの版は、事件報告とOSV記録から復元する。同じ期間の本物のnpmセキュリティ修正（例：200件）では、関門による遅延の中央値を測る。
2. **ノイズ測定**：Dependabot PRのある公開リポジトリ100件で、npm auditの件数とLudionの「本番に関係する」件数を比べる。100件は手で正誤を確かめる。見落としが0なら、見落とし率の上限は約3%と言える。
3. **実利用**：個人開発者5人に2週間使ってもらい、人が触った回数、露出時間の中央値、壊れた自動マージの数を測る。
4. **露出時間**：レシートに残る「修正公開から適用まで」の中央値。

追う指標は二つだけ。露出時間の中央値と、修正1件あたりの人の作業時間。壊れた自動適用は0を目標にし、1件でも出たら自動適用を止めて原因を公開する。

## リスクと未決事項

一番大きいリスクは、GitHubが同じことを標準機能にすることだ。2026年7月に既定の待機時間を入れた以上、方向は同じだと見る。ただし彼らは「セキュリティ更新は即時」を選んだ。来歴で判定して待ち方を変える帯は、まだ空いている。

| リスク | 見立て | 対策 |
| --- | --- | --- |
| GitHubが来歴ベースの判定と自動マージを標準化する | 1年以内に30%前後 | GitHub以外でも動く。ランタイムとベースイメージを扱う。判定の証拠と露出時間の記録で先行する |
| 判定を誤る（悪性版や壊れる更新を通す） | 発生は低いが、起きれば信用が消える | 判定不能は停止。最初はPR止まり。壊れた場合はrevert一回で戻せる形。誤判定は公開で記録する。出所が同じまま悪性コードが入る攻撃は、待機と再照会でしか止まらないと明記する |
| 個人開発者はお金を払わない | 80%以上 | 個人は無料で配布経路にする。収益は保守会社・チーム（複数リポジトリの一括管理、方針、監査用レシート）から |
| 検証の質がテストの質に縛られる | ほぼ確実 | API差分と利用箇所の交わりで補う。同じ署名のまま中身が変わる変更は捉えきれないと明記する |
| Ludion自身が乗っ取られる | 低いが致命的 | 「Ludion自身を攻撃経路にしない」の7つの規則 |

オーナーが決めること（推奨つき）:

- [ ] 入口をどちらにするか。推奨は判定役から。導入の摩擦が最小で、公開リポジトリのDependabot PRでそのまま実験できる。
- [ ] npm名 `ludion-ai` を新製品に使い回すか。推奨は使い回す（旧利用者はほぼゼロ）。ludion という名前はnpmが類似名として拒否済みなので、入口は npx ludion-ai になる。
- [ ] 自動マージの既定。推奨は最初PR止まりで、実績が溜まったら提案。
- [ ] 収益の形。推奨はCLIとActionを無料・公開、複数リポジトリの一括管理を有料。
- [ ] サーバー常駐エージェント（PHP-CGI事件の層）をいつ始めるか。推奨は2027年1月以降、読み取り専用から。

## Sources

- [Check Point — Shai-Hulud 2.0](https://blog.checkpoint.com/research/shai-hulud-2-0-inside-the-second-coming-the-most-aggressive-npm-supply-chain-attack-of-2025/)
- [Semgrep — chalk, debug and color on npm compromised](https://semgrep.dev/blog/2025/chalk-debug-and-color-on-npm-compromised-in-new-supply-chain-attack)
- [Infosecurity Magazine — Log4Shell Downloaded 40 Million Times in 2025](https://www.infosecurity-magazine.com/news/log4shell-downloaded-40-million/)
- [Cisco Talos — New persistent attacks targeting Japan](https://blog.talosintelligence.com/new-persistent-attacks-japan/)
- [W3Techs — Usage statistics of PHP](https://w3techs.com/technologies/details/pl-PHP)
- [GitHub Docs — About Dependabot security updates](https://docs.github.com/en/enterprise-cloud@latest/code-security/concepts/supply-chain-security/about-dependabot-security-updates)
- [GitHub Changelog — Dependabot version updates introduce default package cooldown (2026-07-14)](https://github.blog/changelog/2026-07-14-dependabot-version-updates-introduce-default-package-cooldown/)
- [GitHub Changelog — Dependabot alerts on malicious packages across more ecosystems (2026-07-28)](https://github.blog/changelog/2026-07-28-dependabot-alerts-on-malicious-packages-across-more-ecosystems)
- [Renovate Docs — Merge Confidence](https://docs.renovatebot.com/merge-confidence/)
- [pnpm Docs — Dependency resolution settings](https://pnpm.io/settings/dependency-resolution)
- [GitHub Changelog — npm trusted publishing with OIDC is generally available (2025-07-31)](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/)
- [OpenSSF — Detecting malicious packages using the OSV API](https://openssf.org/?p=11003)
- [GitHub Docs — Automatically merging a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request)
- [GitHub Docs — Triggering a workflow（GITHUB\_TOKENで開いたPR）](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [GitHub Docs — Disabling and enabling a workflow（60日で定期実行が止まる）](https://docs.github.com/en/enterprise-server@3.5/actions/using-workflows/disabling-and-enabling-a-workflow)
- [GitHub Docs — GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Composer — Command-line interface（update、--minimal-changes）](https://getcomposer.org/doc/03-cli.md)
- [uv — lockfileの単一パッケージ更新（pydevtools）](https://pydevtools.com/handbook/how-to/how-to-use-a-uv-lockfile-for-reproducible-python-environments/)
- [Maven Central — Sigstore signature validation via portal（2025-01-28）](https://central.sonatype.org/news/20250128_sigstore_signature_validation_via_portal/)
- [Oracle — Critical Patch Update for October 2026（2026-10-20公開）](https://blogs.oracle.com/ebstech/?p=5539)
- [Oracle — JDK 26.0.2.1 release notes](https://www.oracle.com/java/technologies/javase/26-0-2-1-relnotes.html)
- [Node.js — dist index.json（v26.12.1 security: true）](https://nodejs.org/dist/index.json)
- [japicmp](https://github.com/siom79/japicmp)
- [npm — ludion-ai のダウンロード数（2026-10-05〜10-27）](https://api.npmjs.org/downloads/range/2026-10-05:2026-10-27/ludion-ai)
- [npm registry — ludion-ai 0.1.4（来歴証明・依存）](https://registry.npmjs.org/ludion-ai/0.1.4)
