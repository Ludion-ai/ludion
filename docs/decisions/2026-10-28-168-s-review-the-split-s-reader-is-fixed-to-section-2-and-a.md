## 2026-10-28 (cycle 3, L1) — #168's review: the split's reader is fixed to section 2, and a second execution is reported beside the result

#168's fresh-context review found eight places where `production.ts` (c381a85) leaves out a copy that section 2 of "Gate 1's production/dev split, rebuilt" calls production:
1. code files named `dockerfile*` skipped as source;
2. a type-only match that swallows the next import;
3. literal imports with comments or no spaces (`import(/* … */ 'x')`, `import{a}from"x"`);
4. builtin-named packages (`buffer`, `process`) dropped from P2;
5. full installs missed: a BuildKit heredoc `RUN`, a command's own `NODE_ENV`, `--production=false`;
6. `--import=x`-style loaders;
7. stylesheet import lists and Less options;
8. YAML block-scalar commands and pm2's `script` with `args`.

Section 2's text is not changed. The code is fixed to match it, with a test for each. The review's nits are fixed too: test folder and file names are matched as written (lowercase), `./node_modules/.bin/x` and `node_modules/` paths in commands and in any build tool configuration are read, and package.json's `babel` and `postcss` fields are walked as JSON.

One addition goes beyond section 2's text, in the safe direction: an install with `--include=dev`, `--production=false` or `--prod=false` holds devDependencies even under `NODE_ENV=production`.

- **The result stays the result.** The first execution at c381a85 (count 938, 11 misses) is the registered rerun.
- **A second execution** at the fix commit, with the same script, sample, sources and image, is reported beside it, never instead of it. Its output goes to `docs/bench/2026-10-28-noise-v2/result-fixed/`.
- Every fix only adds production, so its left-out list must be a subset of the result's. Its misses are counted from the review's verdicts for the packages it still leaves out. A left-out package that the review did not check counts as undecidable. No other review is run.
- **Outcome.** The second execution (6c4f58e) gave the same numbers: the judge 938, the same 160 left out, 11 misses in 4 repositories. f0d489e later stopped the reader from backtracking exponentially on a crafted file, which an automated security review flagged. That changes no match.

