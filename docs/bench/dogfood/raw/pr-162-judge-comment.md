<!-- ludion-judge -->
**プレビュー：コメントのみ。この判定でマージは行われない。**

Ludion 判定役 v0（npm）による参考表示で、必須チェックではない。判定するのは関門1・2・4の一部と待機だけで（実装した範囲と「Not checked」は判定役の出力にある）、関門3（旧版と新版のビルド・テスト）は未実装のため実行していない。

判定: **停止**（`stop`） · 判定した head `eedb106d75331a390ef8ade0d2e0b20c74d729da` · 判定にかかった時間: 判定役 4.049 秒、ジョブ開始から 21.72 秒 · [実行ログ](https://github.com/Ludion-ai/ludion/actions/runs/40677044201)

判定役の出力:

    Ludion judgement: STOP — not applied automatically
    Urgency: normal · wait 144h from the newest publish (2026-10-24T18:44:36.789Z)
    Published at or after T (2026-10-21T14:18:56.764Z, the fix's publish time): 2 version(s)
      unist-util-visit-parents@6.1.0
      unist-util-visit@5.2.0
    Changed packages (33):
      @astrojs/internal-helpers 0.12.0 → 0.13.0
      @astrojs/markdown-satteri 0.4.3 → 0.4.5
      @astrojs/prism 4.0.2 → 4.1.1
      @astrojs/telemetry 3.3.3 → 3.4.1
      @oxc-project/types 0.152.0 → 0.155.0
      @rolldown/binding-android-arm-eabi 1.2.12 → 1.2.15
      @rolldown/binding-android-arm64 1.2.12 → 1.2.15
      @rolldown/binding-darwin-arm64 1.2.12 → 1.2.15
      @rolldown/binding-darwin-x64 1.2.12 → 1.2.15
      @rolldown/binding-freebsd-x64 1.2.12 → 1.2.15
      @rolldown/binding-linux-arm-gnueabihf 1.2.12 → 1.2.15
      @rolldown/binding-linux-arm64-gnu 1.2.12 → 1.2.15
      @rolldown/binding-linux-arm64-musl 1.2.12 → 1.2.15
      @rolldown/binding-linux-ppc64-gnu 1.2.12 → 1.2.15
      @rolldown/binding-linux-s390x-gnu 1.2.12 → 1.2.15
      @rolldown/binding-linux-x64-gnu 1.2.12 → 1.2.15
      @rolldown/binding-linux-x64-musl 1.2.12 → 1.2.15
      @rolldown/binding-openharmony-arm64 1.2.12 → 1.2.15
      @rolldown/binding-win32-arm64-msvc 1.2.12 → 1.2.15
      @rolldown/binding-win32-x64-msvc 1.2.12 → 1.2.15
      @shikijs/vscode-textmate 10.0.2 → 10.1.0
      astro 7.3.6 → 7.4.2
      devalue 5.9.4 → 6.0.3
      fnv1a-64 (new) → 0.1.2
      p-queue 9.3.3 → 9.3.5
      postcss 8.5.29 → 8.5.31
      rolldown 1.2.12 → 1.2.15
      smol-toml 1.9.0 → 1.9.1
      tinyps (new) → 0.5.1
      unifont 0.7.5 → 1.0.3
      unist-util-visit 5.1.0 → 5.2.0
      unist-util-visit-parents 6.0.2 → 6.1.0
      vite 8.3.3 → 8.3.5
      [stop] gate 4: The change also touches apps/site/package.json; a dependency update must change only package.json and package-lock.json.
      [stop] gate 2: unist-util-visit-parents@6.1.0 was published at or after the fix (T = 2026-10-21T14:18:56.764Z); only versions already locked or published before T may move with it.
      [stop] gate 2: unist-util-visit@5.2.0 was published at or after the fix (T = 2026-10-21T14:18:56.764Z); only versions already locked or published before T may move with it.
      [extend] gate 2: astro@7.4.2 adds dependencies: tinyps.
      [extend] gate 2: fnv1a-64 is new to the project; there is no earlier version to compare with.
      [extend] gate 2: tinyps is new to the project; there is no earlier version to compare with.
      [extend] gate 2: unifont@1.0.3 adds dependencies: fnv1a-64, std-env.
    Not checked:
      - Gate 3 (build and tests of old and new versions) is not run by the judge v0.
      - Obfuscated code and new network or process calls in the changed code are not inspected.
      - Gate 1's OS, SAPI and configuration conditions are not matched; only production versus dev-only is used.
      - Provenance is read from the registry's attestation record and must name the version and its tarball hash; its Sigstore signature and certificate are not verified here, so provenance (and the same-release exception that relies on it) rests on the registry's checks at publish time.
      - A hijacked publisher account with no provenance change is caught only by the wait and the re-query when it ends; the re-query happens only when the judge is run again after the wait (nothing schedules it yet).
      - The lockfile is read as npm 7 or later reads it (`packages`); the legacy `dependencies` section of a v2 lockfile is not compared.
      - A dependency newly required by a package (nothing satisfied it before) is not compared when it lands on a copy that was already installed; that copy's own advisories are not reported for it.
    Exposure: fix published n/a · seen 2026-10-28T11:04:28.443Z


