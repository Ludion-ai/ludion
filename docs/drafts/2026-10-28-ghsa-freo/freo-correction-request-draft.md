下書き。送らない、公開しない。

# Draft: 追加依頼（OSSF malicious-packages）freo-design-system の未掲載版 — 下書き・未送信

**Status: 下書き・未送信（draft, not sent）.** Prepared for the owner (task 3, cycle 3). Sending it is the owner's decision. Do not post until the owner approves.

**この下書きは ensdomains/buffer の訂正依頼と方向が逆。** freo-design-system 1.0.4 は v5 の「係争中」の基準をすべて満たした（`freo-design-system-1.0.4-analysis.md`）。しかし 1.0.4 の悪性判定は正しく、誤りは「直前の 1.0.3（同一コード）がレコードに載っていない」こと。そこで依頼は **1.0.4 の削除ではなく、1.0.3 ほか未掲載版の追加**。

**Advisory id.** OSV **MAL-2025-3399**（ossf/malicious-packages、`osv/malicious/npm/freo-design-system/MAL-2025-3399.json`）。GitHub Advisory Database には該当レコードがない（`https://api.github.com/advisories?ecosystem=npm&affects=freo-design-system`、`type=malware` 付きでも 0 件、2026-10-28 23:13 JST 確認）。

**Channel.** ossf/malicious-packages。README は誤検知について Issue を求め（"If you see a non-malicious package is flagged as malicious create an issue"）、既存レポートの更新は Pull Request で受け付けるとある（"We accept new reports, and updates to existing reports."）。これは誤検知ではなく追加なので、**Issue（下の本文）か、`affected[0].versions` に版を足す PR** のどちらか。Ludion の方針（PR を開かない／オーナー判断）により、ここでは Issue 本文のみ用意する。どちらにするかはオーナーが決める。

**Scope choice for the owner.** 最小案は 1.0.3 のみ（v5 の証拠基準で 1.0.4 と同一と示せる版）。1.0.2・1.0.5〜1.0.7 は同じ公開者による外部送信コードを持つが、v5 の基準で示したものではない。下の本文は 1.0.3 を主、他を「確認を依頼」として併記している。1.0.3 のみに絞るなら、2 の節を削る。

**What was checked.** 2026-10-28 23:13 JST の公開 API の読み取り（registry、jsDelivr、Software Heritage、ecosyste.ms、OSV、GitHub advisories API）。生データは box の `/workspace/ludion/ghsa/raw/`。v5 の記録は docs/bench/2026-10-28-backtest-v5/malicious-v5.json の freo-design-system@1.0.4 の行。コードは一切実行していない。

---

**Title:** MAL-2025-3399 (freo-design-system): 1.0.3 has the same code as the listed 1.0.4 but is not listed

**Report:** https://github.com/ossf/malicious-packages/blob/main/osv/malicious/npm/freo-design-system/MAL-2025-3399.json (affected versions `1.0.4`, `1.0.1`; modified 2025-04-28T05:47:09Z)

**Requested change:** add `1.0.3` to `affected[0].versions`. Please also consider `1.0.2`, `1.0.5`, `1.0.6` and `1.0.7` (see 2). This is not a false-positive report: 1.0.4 and 1.0.1 should stay.

**Why.**

1. **1.0.3 is byte-identical in code to 1.0.4, and runs it on install.**
   - Registry tarballs (both still served):
     - 1.0.3: https://registry.npmjs.org/freo-design-system/-/freo-design-system-1.0.3.tgz, sha1 `4e705c9737a2b8d89286db4d82d9e642b033a6a3`, integrity `sha512-g82HWpPmuLylNzdPUKKADwG95DKpIxpacZgNfVlAo/lkOmF/+pupEpzcrmRrrgKzrsdDn+UqPniS/P+lyGfqVg==`, published 2025-04-25T20:52:19.872Z;
     - 1.0.4: https://registry.npmjs.org/freo-design-system/-/freo-design-system-1.0.4.tgz, sha1 `c2c00593539e871f247fc6c31fcb958de8f5d9d7`, integrity `sha512-2Tz+3x3QA2EAiesyprujknm2obMxuaw0I31moOCe/BZ4LQDpHCBq27ihJ5i0AzMTsm4kLy0oQetwUCvHy9TYPw==`, published 2025-04-25T21:51:55.175Z.
   - Both contain the same 2 files. `index.js` has sha256 `28d4ca620c9297a4ef869dcf5f3d83d0917359468319402e95b150ba57114862` (784 bytes) in both. `package.json` differs only in `"version"`; both declare `"preinstall": "node index.js"`.
   - Two independent archives confirm 1.0.4's files and tie them to the registry hash:
     - Software Heritage: visit of 2025-12-05, directory `swh:1:dir:7acd82168578cfa3bf2783d332a7069718e76c37`; its original-artifact record names the registry tarball URL above with sha1 `c2c00593539e871f247fc6c31fcb958de8f5d9d7`;
     - jsDelivr: https://data.jsdelivr.com/v1/packages/npm/freo-design-system@1.0.4?structure=flat (and `@1.0.3` lists the same `index.js` hash).
   - The code takes `os.userInfo().username` and `os.hostname()`, builds `<username>-<hostname>.d05v713s0ahbkct7e3p04ipx6sf7m8tu5.oast.live`, and runs `dig` / `host` / `nslookup` on it. That is the behaviour the 1.0.4 entry describes ("communicates with a domain associated with malicious activity").

2. **Other versions by the same publisher that may also belong** (not checked to the same standard; please verify):
   - 1.0.2 (2025-04-25T20:43:12.565Z): the same `index.js` (same sha256) as 1.0.4, without a `preinstall`; `main` is `index.js`, so it runs when the package is required.
   - 1.0.5, 1.0.6, 1.0.7 (2025-04-25 to 2025-04-28): `"preinstall": "node index.js"`, with a different `index.js` that collects host information (hostname, DNS servers and more) and sends it over HTTPS to a host under `oast.me`. Its header reads "DNS Request Demo Script - EDUCATIONAL PURPOSES ONLY".
   - Every version, 1.0.0 to 1.0.7, was published by the npm account `david96`.

**Why it matters.** Tools that consume OSV (or the OSV export) will not flag 1.0.3, although installing it runs exactly the code that got 1.0.4 listed. In our own backtest, the gap made 1.0.3 look like the "preceding legitimate version" of 1.0.4.

**Limits of this evidence.** It shows identical files and hashes; it does not show whether the automated analysis ever ran on 1.0.3, or why it was not listed. We did not run any of the code. Whether the publisher's activity was authorised research is not known to us; the repository's scope includes security researcher activity and dependency confusion either way.
