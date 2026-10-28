<!-- ludion-judge -->
**プレビュー：コメントのみ。この判定でマージは行われない。**

Ludion 判定役 v0（npm）による参考表示で、必須チェックではない。判定するのは関門1・2・4の一部と待機だけで（実装した範囲と「Not checked」は判定役の出力にある）、関門3（旧版と新版のビルド・テスト）は未実装のため実行していない。

判定: **可（関門3は未実施のため、適用してよいという判定ではない）**（`ready_except_build`） · 判定した head `6b4f7171aab7c2eba43f038a460d071f298fbdf0` · 判定にかかった時間: 判定役 5.637 秒、ジョブ開始から 20.538 秒 · [実行ログ](https://github.com/Ludion-ai/ludion/actions/runs/40679684709)

判定役の出力:

    Ludion judgement: gates 1, 2 and 4 found nothing and the wait is over — build/test gate not run (v0)
    Urgency: normal · wait 144h from the newest publish (2026-10-15T14:29:01.396Z)
    Published at or after T (2026-10-15T14:29:01.396Z, the fix's publish time): 0 version(s)
    Changed packages (8):
      @jridgewell/trace-mapping 0.3.9 → 0.3.31 (dev)
      @vitest/mocker 4.1.12 → 5.0.5 (dev)
      @vitest/spy 4.1.12 → 5.0.5 (dev)
      magic-string 0.30.21 → 1.4.3
      obug 2.2.1 → 3.0.0
      tinybench 2.9.0 → 6.2.2 (dev)
      vitest 4.1.12 → 5.0.5 (dev)
      why-is-node-running 2.3.0 → 3.2.1 (dev)
      [extend] gate 2: @vitest/mocker@5.0.5 adds dependencies: @jridgewell/trace-mapping.
      [extend] gate 2: tinybench@6.2.2 was published by GitHub Actions, 2.9.0 by aslemammad.
      [extend] gate 2: vitest@5.0.5 adds dependencies: @types/chai, chai.
      [extend] gate 2: why-is-node-running@3.2.1 was published by jkoops, 2.3.0 by mafintosh.
    Not checked:
      - Gate 3 (build and tests of old and new versions) is not run by the judge v0.
      - Obfuscated code and new network or process calls in the changed code are not inspected.
      - Gate 1's OS, SAPI and configuration conditions are not matched; only production versus dev-only is used.
      - Provenance is read from the registry's attestation record and must name the version and its tarball hash; its Sigstore signature and certificate are not verified here, so provenance (and the same-release exception that relies on it) rests on the registry's checks at publish time.
      - A hijacked publisher account with no provenance change is caught only by the wait and the re-query when it ends; the re-query happens only when the judge is run again after the wait (nothing schedules it yet).
      - The lockfile is read as npm 7 or later reads it (`packages`); the legacy `dependencies` section of a v2 lockfile is not compared.
      - A dependency newly required by a package (nothing satisfied it before) is not compared when it lands on a copy that was already installed; that copy's own advisories are not reported for it.
    Exposure: fix published n/a · seen 2026-10-28T11:24:37.723Z


