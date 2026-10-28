下書き。送らない、公開しない。

# freo-design-system 1.0.4 は v5 の「係争中」の証拠基準を満たすか（調査メモ）

- 状態：**内部メモ・未送信・非公開**
- 調査日時：2026-10-28 23:13 JST（2026-10-28T14:13:01Z）に公開 API を読み取りのみで取得。生データは `/workspace/ludion/ghsa/raw/`（box 上）
- 参照した repo：Ludion-ai/ludion main `51a8f0b09494c8dac34ef0d258a738d780f72efc`（PR #167 のマージ。マージ時刻 2026-10-28 22:32:03 JST）
- Software Heritage への匿名リクエスト：今回 8 回（上限 120 回/時。応答ヘッダ `X-Ratelimit-Remaining: 119` を確認）

## 結論（先に）

1. **v5 の基準（definitions.md 第3節の 5 項目）はすべて満たす。** v5 の実行結果（`malicious-v5.json` の freo-design-system@1.0.4 の行、`"step":"disputed"`）を、今回独立に取り直したデータで再確認できた。
2. **ただし、これは「1.0.4 が誤って悪性とされている」ことを意味しない。** 1.0.4 の `index.js` は、インストール時（`preinstall`）にユーザー名とホスト名を外部ドメイン（`*.oast.live`）への DNS 問い合わせで送るコードで、OSSF の定義では悪性に当たる。1.0.4 が「係争中」になったのは、**直前の 1.0.3 がどの MAL- レコードにも載っていない**（＝ v5 の定義上「正当」とみなされる）ためで、1.0.3 自体も同じコードを持つ。
3. したがって、正しい訂正の方向は **「1.0.4 を外す」ではなく「レコード MAL-2025-3399 に 1.0.3（と、同じ公開者の未掲載版）を加える」**。この方向で下書き `freo-correction-request-draft.md` を作った（下書き・未送信）。
4. GitHub Advisory Database には該当レコードがない（後述）。窓口は **ossf/malicious-packages**。

## v5 の基準（原文の引用）

docs/decisions.md（2026-10-28 cycle 3 の項）：

> **Disputed (係争中).** A version named malicious for which the registry's hash and two independent archives (Software Heritage and jsDelivr, tied to that hash) show that its code equals the immediately preceding legitimate version's. Disputed versions stay in the malicious denominator, and are also counted apart.

docs/bench/2026-10-28-backtest-v5/definitions.md 第3節：

> **Meaning.** A version named malicious for which it can be shown, with the registry's hash and two or more independent archives, that its code is identical to the immediately preceding legitimate version. Disputed versions **stay in the malicious denominator** with their outcomes, and are also counted and listed apart. The gates do not change.

> **What this does not claim.** A changed data file (`.json`) can still change what identical code does. The category says only that V's code equals prev_d's, not that V is benign. That is why V stays in the denominator.

5 項目（definitions.md 第3節 1〜5）の原文は各項目の下に引用する。

## 対象レコード

| 項目 | 値 | 出典 |
| --- | --- | --- |
| OSV レコード | **MAL-2025-3399**（aliases なし、withdrawn なし）。published 2025-04-25T20:32:55Z、modified 2025-04-28T05:47:09Z | `POST https://api.osv.dev/v1/query` `{"package":{"name":"freo-design-system","ecosystem":"npm"}}` → 返ったのはこの 1 件のみ |
| affected versions | `["1.0.4", "1.0.1"]` | 同上、および https://api.osv.dev/v1/vulns/MAL-2025-3399 |
| 由来 | ossf-package-analysis が 2 回（1.0.1: modified 2025-04-25T20:32:55Z、1.0.4: modified 2025-04-25T22:03:11Z）。1.0.4 の理由は "The package communicates with a domain associated with malicious activity." | https://github.com/ossf/malicious-packages/blob/main/osv/malicious/npm/freo-design-system/MAL-2025-3399.json |
| GHSA | **なし**。`https://api.github.com/advisories?ecosystem=npm&affects=freo-design-system` と `&type=malware` 付きの両方で 0 件 | GitHub REST API（認証なし） |
| 1.0.3 を名指すレコード | なし。`POST https://api.osv.dev/v1/query` に `"version":"1.0.3"` → `{}` | OSV API |

## 基準ごとの判定

### 1. 直前の正当な版（prev_d）— **満たす**

> 1. **The preceding legitimate version** prev_d is the latest version of P published before V (registry `time`) that no MAL- record in the OSV export names, in `versions` or within a SEMVER range. (...) The registry must list prev_d, and its tarball, downloaded from the registry, must match the registry's sha512 `dist.integrity`. Otherwise V is not disputed.

- registry の `time`（https://registry.npmjs.org/freo-design-system）：1.0.0 2024-10-14T15:56:59.149Z / 1.0.1 2025-04-25T20:25:39.682Z / 1.0.2 2025-04-25T20:43:12.565Z / **1.0.3 2025-04-25T20:52:19.872Z** / **1.0.4 2025-04-25T21:51:55.175Z** / 1.0.5 2025-04-25T22:09:04.753Z / 1.0.6 2025-04-25T22:15:24.197Z / 1.0.7 2025-04-28T20:46:30.237Z
- 1.0.4 より前で MAL- に載らない最新版は **1.0.3**（MAL-2025-3399 は 1.0.1 と 1.0.4 のみ）。v5 の記録も `"prev_d":"1.0.3"`。
- registry は 1.0.3 を掲載中。tarball https://registry.npmjs.org/freo-design-system/-/freo-design-system-1.0.3.tgz を取得：676 bytes、sha1 `4e705c9737a2b8d89286db4d82d9e642b033a6a3`、sha512 `sha512-g82HWpPmuLylNzdPUKKADwG95DKpIxpacZgNfVlAo/lkOmF/+pupEpzcrmRrrgKzrsdDn+UqPniS/P+lyGfqVg==` → registry の `dist.integrity` と一致。

### 2. registry のハッシュ — **満たす**

> 2. **The registry's hash of V** is its `dist.shasum` (sha1) and `dist.integrity` (sha512) (...). For a version the registry still lists, the registry itself gives it. (...) At least one copy must give it, and every copy that gives a value must agree.

1.0.4 は registry 掲載中。3 つの写しがすべて一致：

| 写し | shasum | integrity | unpackedSize |
| --- | --- | --- | --- |
| registry | `c2c00593539e871f247fc6c31fcb958de8f5d9d7` | `sha512-2Tz+3x3QA2EAiesyprujknm2obMxuaw0I31moOCe/BZ4LQDpHCBq27ihJ5i0AzMTsm4kLy0oQetwUCvHy9TYPw==` | 1053 |
| ecosyste.ms（https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/freo-design-system/versions/1.0.4 、created_at 2025-05-27T09:48:47.376Z） | 同上 | 同上 | 1053 |
| Software Heritage `replicate-npm-package-json`（https://archive.softwareheritage.org/api/1/raw-extrinsic-metadata/get/a80c0572139bc809d68bf92378e7eede73e584e7/ 、discovery 2025-12-05T04:09:22+00:00） | 同上 | 同上 | 1053 |

registry から取った tarball 自体も sha1 `c2c00593539e871f247fc6c31fcb958de8f5d9d7`、sha256 `7718f6b45c446d1e86e5e2808fdcad4bf2d2fa8b787d72c1b7520bea0d5a5c8b`、676 bytes。

### 3. 2 つの独立したアーカイブが同じファイルを持つ — **満たす**

> 3. **Two independent archives hold V's files: Software Heritage and jsDelivr.** (...) Both must list the same set of paths, with the same sha256 for every file.

- Software Heritage：origin `https://www.npmjs.com/package/freo-design-system` の visit 4（2025-12-05T04:09:22.569000+00:00、status full、snapshot `f6f02dd18935dc3eedbb14234c2b36af21f2335a`）。それ以前の visit 1〜3（2025-04-06、2025-04-21、2025-05-05）はすべて `failed`・snapshot なし。branch `releases/1.0.4` → release `d79157f62305cc629736ef7d66533e8586652eb8`（synthetic、date 2025-04-25T21:51:55+00:00）→ directory `swh:1:dir:7acd82168578cfa3bf2783d332a7069718e76c37`（中身は `package/` フォルダ 1 つ → package root `e6ef31022b402d194646ed736bd43294f3ee7266`）。
- jsDelivr：https://data.jsdelivr.com/v1/packages/npm/freo-design-system@1.0.4?structure=flat

| パス | Software Heritage sha256 | jsDelivr（base64 sha256 → hex） | size |
| --- | --- | --- | --- |
| `index.js` | `28d4ca620c9297a4ef869dcf5f3d83d0917359468319402e95b150ba57114862` | `KNTKYgySl6Tvhp3PXz2D0JFzWUaDGUAulbFQulcRSGI=` = 同じ | 784 |
| `package.json` | `1438809cbaeab5ca7a2326fb9344415d011b32bc821a63493cb5bcb393952f38` | `FDiAnLrqtcp6Iyb7k0RBXQEbMryCGmNJPLW8s5OVLzg=` = 同じ | 269 |

パスの集合（2 ファイル）も一致。jsDelivr CDN（https://cdn.jsdelivr.net/npm/freo-design-system@1.0.4/ ）は HTTP 200 で、実ファイルの sha256 も上と一致。

### 4. アーカイブがハッシュに結び付いている — **満たす**

> 4. **The archives are tied to the registry's hash.** Software Heritage's `original-artifacts-json` for those files names the registry's tarball URL for V, with a sha1 equal to the registry's `shasum`, or a sha512 equal to its `integrity`. Where copies of the version document give `dist.unpackedSize`, they must agree, and jsDelivr's file sizes must add up to it.

- `original-artifacts-json`（https://archive.softwareheritage.org/api/1/raw-extrinsic-metadata/get/5b0786355e18e9851731e53efeb602f3dc3592e4/ ）：
  `{"length": 676, "filename": "freo-design-system-1.0.4.tgz", "checksums": {"sha1": "c2c00593539e871f247fc6c31fcb958de8f5d9d7", "sha256": "7718f6b45c446d1e86e5e2808fdcad4bf2d2fa8b787d72c1b7520bea0d5a5c8b"}, "url": "https://registry.npmjs.org/freo-design-system/-/freo-design-system-1.0.4.tgz"}` → URL も sha1 も registry と一致。
- unpackedSize：3 写しとも 1053。jsDelivr のサイズ合計 784 + 269 = 1053。一致。

### 5. コードが prev_d（1.0.3）と同一 — **満たす**

> 5. **The code is identical to prev_d's.** (...) Every file of V is either inert or present in prev_d at the same path with the same sha256. (...) **The root `package.json`** may change, but these fields must be equal in V and prev_d (...) **Runtime requirements.** Every entry of V's `dependencies`, `optionalDependencies` and `peerDependencies` appears in prev_d's (...)

- `index.js`（code）：1.0.3 の registry tarball 内 sha256 `28d4ca620c9297a4ef869dcf5f3d83d0917359468319402e95b150ba57114862` = 1.0.4 と同じ（jsDelivr 1.0.3 の一覧 `KNTKYgySl6Tvhp3PXz2D0JFzWUaDGUAulbFQulcRSGI=` とも一致）。
- `package.json`：1.0.3 sha256 `a72cd82d3b40bf73e362e4e38e34463158a26f006e08ccaebf34f21dd6652772`、1.0.4 sha256 `1438809cbaeab5ca7a2326fb9344415d011b32bc821a63493cb5bcb393952f38`。`diff` の差分は `"version": "1.0.3"` → `"1.0.4"` の 1 行のみ。比較対象フィールド（`scripts.preinstall` = `"node index.js"` を含む）はすべて同値。dependencies 系はどちらもなし。
- 追加・削除ファイルなし。

## 判定のまとめ

| # | 基準 | 判定 |
| --- | --- | --- |
| 1 | prev_d = 1.0.3、registry 掲載、integrity 一致 | 満たす |
| 2 | registry のハッシュ（3 写しが一致） | 満たす |
| 3 | Software Heritage と jsDelivr が同じ 2 ファイル・同じ sha256 | 満たす |
| 4 | SWH の original artifact が registry の URL・sha1 と一致、unpackedSize 一致 | 満たす |
| 5 | コードが 1.0.3 と同一（差は version のみ） | 満たす |

→ **v5 の「係争中」の基準はすべて満たす**（v5 の結果と一致）。

## ただし：何が「誤り」なのか

v5 の README 自身が書いているとおり（"So 1.0.4 is disputed because no MAL- record names 1.0.3, not because anything puts 1.0.4's label in question. The likelier reading is that the record does not cover 1.0.3."）、今回のデータもそれを裏付ける：

- 1.0.4 の `index.js` は、`os.userInfo().username` と `os.hostname()` を `${username}-${hostname}.d05v713s0ahbkct7e3p04ipx6sf7m8tu5.oast.live` という名前に入れ、`dig` / `host` / `nslookup` を `exec` する（`preinstall` で自動実行）。OSSF malicious-packages の定義（"exfiltrates an identifier that can be directly used to launch a subsequent attack against the victim (e.g. username ...)"、"security researcher activity" と "dependency and manifest confusion" は対象範囲）では悪性。
- 公開者は全版 `david96`（`_npmUser.email` は `david96@wearehackerone.com`）。1.0.5 以降の `index.js` 冒頭に "DNS Request Demo Script - EDUCATIONAL PURPOSES ONLY" / "Created by: https://hackerone.com/david96" とある。バグバウンティ研究者による依存関係かく乱（dependency confusion）型の検証パッケージとみられる（推測。公開者の意図は確認していない）。
- **1.0.4 の悪性判定は誤りではない。** 漏れているのは他の版：

| 版 | index.js（jsDelivr の sha256, base64） | preinstall | MAL-2025-3399 に載っているか |
| --- | --- | --- | --- |
| 1.0.0 | `5D9DT1snsVOWoaqV8VVqdCbO5S3p+h7BcZvyR4CNfIo=`（97 bytes） | なし | なし（内容は未確認） |
| 1.0.1 | `ZJ3jG6zGpwX6LitDPyrbcpXVjUPFeBFJrNwRIdOgaEo=`（644） | なし | **あり** |
| 1.0.2 | `KNTKYgySl6Tvhp3PXz2D0JFzWUaDGUAulbFQulcRSGI=`（784、1.0.4 と同一） | なし（`main` が index.js なので require 時に実行） | なし |
| 1.0.3 | `KNTKYgySl6Tvhp3PXz2D0JFzWUaDGUAulbFQulcRSGI=`（784、1.0.4 と同一） | `node index.js` | **なし** |
| 1.0.4 | `KNTKYgySl6Tvhp3PXz2D0JFzWUaDGUAulbFQulcRSGI=`（784） | `node index.js` | **あり** |
| 1.0.5 | `BEGTc11evfEgV63gqCO8v+VsOWkXAKDf74V+jEEs+IQ=`（1392） | `node index.js` | なし |
| 1.0.6 | `6J6v+XOaKgyGFqHryTx0Yu1SQvu4IDdg7/p0X+cbmEQ=`（2999） | `node index.js` | なし |
| 1.0.7 | `RzXHXMigbsrrmYK/v3wZUGqemzL1qfR9sMUtk7d0RBU=`（3000） | `node index.js` | なし |

（1.0.5〜1.0.7 は `grep` で `oast.me` への https 送信・`os.hostname()`・`dns.getServers()` 等を確認しただけで、全文は読んでいない。コードは一切実行していない。）

## Ludion への含意

- v5 の「係争中」は定義どおり機能したが、2 件のうち 1 件（freo）は「誤報」ではなく「レコードの取りこぼし」を拾った。**「係争中」＝「誤報の候補」ではない**。LS（シャドー運用）の「悪性情報の誤報の検出」では、「同一コードの直前版が未掲載」の場合に（a）V が誤報か（b）直前版の取りこぼしか、を分けて扱う必要がある（例：直前版自体に install script や外部送信があれば (b) 寄り）。
- Ludion は 1.0.4 を全待機時間で止めている（`stopped`）。これは正しい結果。

## 「不明」な点

- 1.0.0 の内容（97 bytes の index.js）は読んでいない：不明。
- 1.0.5〜1.0.7 が OSSF の基準で悪性かどうかの最終判断：不明（外部送信コードの存在は確認、全文精査はしていない）。
- OSSF の自動解析が 1.0.2・1.0.3・1.0.5〜1.0.7 を解析したかどうか、したなら何故載せなかったか：不明（公開データにない）。
- Software Heritage のローダーがダウンロード時にチェックサムを検証したか：不明（ensdomains の下書きと同じ限界）。
- 公開者の意図（認可されたバグバウンティ調査かどうか）：不明。
