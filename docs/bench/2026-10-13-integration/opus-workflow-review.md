# Verdict: no actionable blocker in the provided integration region

The delta is a pure move of four existing steps to just after `typecheck` and before `npm run build`. No step content, id, condition or key changed. The composed order meets each stated requirement:

- **Chromium before build:** The `playwright` → `browsers` cache → `Install Chromium` / `Install Chromium's system dependencies` steps now run before `npm run build`. `apps/site/package.json` `build` runs `astro build && node scripts/og.ts`. In `og.ts`, `makeCards()` calls `chromium.launch()` only after this install.
- **Version lookup:** The Playwright version step runs after `npm ci`, so `require('@playwright/test/package.json')` resolves.
- **Step references:** `steps.playwright.outputs.version` and `steps.browsers.outputs.cache-hit` both point to earlier steps. The old copies were removed, so there are no duplicate step ids. The cache-hit and cache-miss branches are still mutually exclusive.
- **Bootstrap, build and test order:** The order is preserved: `npm ci` → `typecheck` → `build` → `build:samples` → `npm test` → `sandbox-smoke.ts` → `runtime-tasks-cli.ts --self-check` → `replay-smoke.ts` → upload → `test:e2e`. The Worker tests still follow the build. `test:e2e` still follows the browser install.
- **Docker-only fixtures and artifact privacy:** These steps are unchanged. The `upload-artifact` paths are unchanged and still limited to `runtime-acceptance.json`, `runtime-replay.json` and `$RUNNER_TEMP/runtime-artifacts`. The share-card PNGs go to `apps/site/dist/bench/og/` and are not uploaded.
- **Node runtime order:** The `.node-version` runtime still drives everything through `test:e2e`, including `node scripts/og.ts`. The tarball is packed under that runtime. The pinned `setup-node@949feb2…` (22.19.0) still runs immediately before `Check the tarball on the minimum Node` (`tools/cli-smoke.mjs`).
- **`og.ts` (new upstream code):** Its local server binds to `127.0.0.1` and has a traversal guard (`startsWith(root + sep)`). If there are no `/bench/og` pages, it returns before launching Chromium. If any card is missing, it fails the build, which is the intended gate.

# Limitations and advisories (not blockers)

1. **Deploy workflow not provided.** `og.ts` notes that "the deploy runs no e2e to notice." If a deploy or other workflow runs `npm run build` on a runner without Chromium, it will now fail in `makeCards()` whenever `/bench/og/*` pages exist. Please confirm that workflow installs Chromium too. I could not verify this from the material given.
2. **Undeclared dependency.** `apps/site/package.json` does not declare `@playwright/test`, yet `og.ts` imports it. This works through root workspace hoisting after a root `npm ci`, but it would break any workspace-isolated install. Consider declaring it as a devDependency of `@ludion/site`.
3. **Job time.** The share-card screenshots now count toward `timeout-minutes: 15` during the build. Watch the running CI for headroom.
4. **Scope.** I did not observe actual CI results, and I did not see `scripts/samples.ts`, the Docker/harness code, the tool scripts or the action tag pinning. These were out of scope or already reviewed.