<!-- ludion-judge -->
**プレビュー：コメントのみ。この判定でマージは行われない。**

Ludion 判定役 v0（npm）による参考表示で、必須チェックではない。判定するのは関門1・2・4の一部と待機だけで（実装した範囲と「Not checked」は判定役の出力にある）、関門3（旧版と新版のビルド・テスト）は未実装のため実行していない。

判定: **停止**（`stop`） · 判定した head `b5014ddae044f02288232f13b5d1863a3089bdb2` · 判定にかかった時間: 判定役 0.695 秒、ジョブ開始から 14.801 秒 · [実行ログ](https://github.com/Ludion-ai/ludion/actions/runs/40676504450)

判定役の出力:

    Ludion judgement: STOP — not applied automatically
    Urgency: normal · wait 72h from the newest publish (2026-10-25T07:19:30.732Z)
    Published at or after T (2026-10-25T07:19:30.732Z, the fix's publish time): 0 version(s)
    Changed packages (1):
      hono 4.13.13 → 4.13.14
      [stop] gate 4: The change also touches apps/worker/package.json; a dependency update must change only package.json and package-lock.json.
    Not checked:
      - Gate 3 (build and tests of old and new versions) is not run by the judge v0.
      - Obfuscated code and new network or process calls in the changed code are not inspected.
      - Gate 1's OS, SAPI and configuration conditions are not matched; only production versus dev-only is used.
      - Provenance is read from the registry's attestation record and must name the version and its tarball hash; its Sigstore signature and certificate are not verified here, so provenance (and the same-release exception that relies on it) rests on the registry's checks at publish time.
      - A hijacked publisher account with no provenance change is caught only by the wait and the re-query when it ends; the re-query happens only when the judge is run again after the wait (nothing schedules it yet).
      - The lockfile is read as npm 7 or later reads it (`packages`); the legacy `dependencies` section of a v2 lockfile is not compared.
      - A dependency newly required by a package (nothing satisfied it before) is not compared when it lands on a copy that was already installed; that copy's own advisories are not reported for it.
    Exposure: fix published n/a · seen 2026-10-28T11:34:42.607Z


