# 2026-10-29 (L1d) — The 69 misses fixed by cause; the third sample of 100 meets neither gate

docs/bench/2026-10-29-l1d; PR #196.
- Commit order: classification 9bb87fc, then fix cfbd159, then the third sample's registration 2692611 (pushed before the search), then the search 63d7d2c, then the measurements at 2692611's code.
- The decisions are in docs/decisions/2026-10-29-l1d-fix.md and docs/decisions/2026-10-29-l1d-third-sample.md.

**Step 1, the causes of the 69 misses** (58 in L1c's new 100, 11 in the original 100), one row per package:

| Cause | Misses |
| --- | --- |
| An archive missing its `export-ignore` files, read as complete | 44 |
| Tool hand-offs: webpack → webpack-cli → webpack-dev-server, and ts-node for `webpack.config.ts` | 15 |
| Modules named by non-literal arguments or joined path segments | 9 |
| Umi's config file, which P2 did not list | 1 |

**The fix.** Each change only makes more copies production, and the fresh-context review confirmed this (`reviewed-sha: 63d7d2c`, APPROVE). All 69 are now counted: 0 misses remain in either earlier sample.

**Count gate, not met:**
- **Third 100 (the verdict):** npm audit 1,972, judge 1,021. 3,063 > 1,972, and the gate needs ≤ 657.
- Reference samples:
  - original: 1,871 and 950;
  - second: 2,142 and 1,062.

**Miss gate, not met.** **Third 100:** 6 misses (5 yes, 1 undecidable) in 4 repositories, from causes the fix did not cover:
- **4:** a build script runs a package from inside a script file (`execSync("npx mcpb pack")`);
- **1:** a pino logger transport named by a string at start;
- **1:** a `node_modules/wrangler` path in `wrangler.jsonc`, which the reviewer could not decide.

  Reference samples: 0 misses each.

**Overlap:** 0 repositories and 0 owners shared with the earlier samples. No repository failed. The code-review fix after the runs started (45079c2) changes 0 pairs in all three samples.

**Left for the owner:**
- the count needs a definition change (no implementation fix brings it down);
- the open readings: commands inside script files, string-named transports and plugins, configuration files P2 does not list (`wrangler.jsonc`), CI deploy workflows, and `package` scripts;
- a reviewer found an obfuscated payload in a third-sample repository's build script (Joshuasco/coffeeShop, `api.js`). It is shown in the README and was not run.
