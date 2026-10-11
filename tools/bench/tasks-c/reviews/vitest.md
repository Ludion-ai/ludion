**Fresh-context review (subagent) of the vitest C tasks: approve with fixes**

Scope: 11 tasks (vitest-5-0-0-{3,4,5,7,9,12,13,14,16,18,24}-c). `npx vitest run tools/bench` passes (51/51). I checked each trap against keys.json and against the installed vitest 5.0.3 sources in the prepared project where I could: config lookup (`findConfigFile`, root only), no `vitest/runners` export and no `@vitest/runner` installed, blob default `.vitest/blob`, `browser.locators.exact` default true, `fullTestName` joined with " > ", hoistMocks throws, `--repeats` CLI, static `vitest list`. Every trap holds. I re-ran the rules on hand-written variant solutions with a copy of `codeText` + `gradeRules` (results below). Findings are listed most severe first.

## 1. vitest-5-0-0-14-c (cause is in the harness, so it can hit any task): comment stripping eats globs inside strings
`codeText` removes `/\*[\s\S]*?\*\//` even inside string literals. A glob like `'test/contract/*.test.ts'` opens a "comment" that runs up to the next `*/`, for example the `**/` in the unit project's `'src/**/*.test.{js,ts}'`. Everything in between disappears. Both of these correct configs grade **wrong** (verified):
```ts
projects: [
  { test: { include: ['test/contract/*.test.ts'], name: 'contract' }, extends: false },
  { extends: true, test: { name: 'unit', include: ['src/**/*.test.{js,ts}'] } },
]
```
and the same with `extends: false` first but `name` after `include`. Single-star globs are natural here because test/contract is flat.
Fix (tools/bench/src/rule-tasks.ts, `codeText` for JS/TS): skip string literals while stripping, e.g.
```js
text.replace(/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, s) => s ?? "")
```
Keep a test that `include: ['a/*.ts', 'b/**/*.ts']` survives unchanged.

## 2. vitest-5-0-0-18-c: `--repeats 20` runs each test 21 times, so the exact answer (19) fails
In the installed runner (`dist/chunks/run.BTlFXlnv.js:3859`) the loop is `for (repeatCount = 0; repeatCount <= repeats; ...)`. The prompt asks to run every test "20 times", so a careful solver writes `--repeats 19` and is graded wrong (verified). Fix: accept both values. Rule 1 becomes `"test:flaky"\s*:\s*"[^\n]*\bvitest\b[^\n]*--repeats(?:=|\s+)(?:19|20)\b`, and the config rule becomes `repeats\s*:\s*(?:19|20)\b`. (Or change the prompt to "at least 20 times" and accept `--repeats(?:=|\s+)(?:19|[2-9]\d|\d{3,})\b`.)

## 3. vitest-5-0-0-5-c: the config rule only accepts a string literal for `runner`
`runner: fileURLToPath(new URL('./test/timing-runner.ts', import.meta.url))`, the style used elsewhere in these overlays (task 4's config), grades wrong (verified). So does `runner: path.resolve(__dirname, 'test/timing-runner.ts')`. Fix (both alternatives): `runner\s*:[^\n]*timing-runner` (or `runner\s*:[\s\S]{0,200}?timing-runner`).

## 4. vitest-5-0-0-13-c: a test-name filter that lists the two tests is correct but graded wrong
`vitest run src/cart.test.js -t "charges the total|rejects an empty cart"` uses Vitest's test-name filter and runs exactly the cart checkout tests (verified wrong). Fix the prompt instead of the rule, so the trap stays: "...that runs only the cart checkout tests in src/cart.test.js: the whole checkout block inside cart (including tests added to it later), not the checkout block inside wishlist. Use Vitest's test-name filter; don't edit the tests."

## 5. vitest-5-0-0-12-c: alternative 1 depends on option order
`getByRole('button', { exact: false, name: 'Delete' })` grades wrong (verified), because the rule needs `Delete` before `exact`. Fix the first rule of alternative 1 to: ``getBy\w+\((?=[^)]*['"`]Delete)(?=[^)]*exact\s*:\s*false)``

## 6. vitest-5-0-0-7-c and vitest-5-0-0-12-c (overlay): the browser provider is declared but not installed
The overlay package.json adds `@vitest/browser-playwright` 5.0.3 and `playwright`, and vitest.config.js imports `@vitest/browser-playwright`. The prepared project's node_modules has neither package; only `@vitest/mocker` and `@vitest/spy` are in `@vitest/`. `vitest/browser/context.d.ts` only re-exports from `@vitest/browser-playwright/context`. So the matcher and locator docs (toHaveTextContent / toMatchTextContent, `exact`) can't be read locally, and the config imports a package that doesn't resolve. That pushes the assistant toward memory and makes these two tasks harder than the others to answer by reading. Fix: add `"@vitest/browser-playwright": "5.0.3"` and `"playwright"` to tools/bench/projects/vitest/package.json, then reinstall the prepared project with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (nothing is run, so no browser is needed).

## 7. vitest-5-0-0-24-c: "without running the tests" fights the docs wording
The CLI docs say "Pass --no-static-parse to run the files instead". An assistant that has read them may keep static parsing to obey "without running the tests" and fail. The prompt's real intent is "don't execute the tests". Fix the prompt: "...writes that list as JSON to tests.json, without executing any test (collecting them is fine)."

## 8. vitest-5-0-0-4-c: alternative 4 requires the literal word `vitest` after `cd ../..`
`"test": "cd ../.. && npm test -- packages/api"` is correct (the root script is `vitest run`) but grades wrong (verified). Fix alternative 4: `"test"\s*:\s*"[^\n]*\bcd\s+\.\./\.\.[^\n]*packages/api`. (Minor and optional: alternative 3 also accepts a local config that sets only `setupFiles` without the alias.)

## 9. vitest-5-0-0-3-c (low)
- Alternative 1 accepts `expect(() => applyCoupon(...))` but not `expect(async () => applyCoupon(...))`, which is also correct (verified wrong). Replace `(?:\(\)\s*=>\s*)?` with `(?:(?:async\s*)?\(\)\s*=>\s*)?`.
- "Keep it in the same style as the other tests in that file" directly tells the assistant to copy the un-awaited pattern, so a correct answer has to disobey the prompt. Consider dropping that sentence; the un-awaited neighbours are lure enough.

## 10. vitest-5-0-0-14-c (low)
- Alternative 1 accepts `extends: false` anywhere, for example on the unit project (which breaks unit, while contract still inherits the stub). Optional tightening: require `extends: false` and `name: 'contract'` in the same project object, e.g. ``\{[^{}]*extends\s*:\s*false[^{}]*test\s*:\s*\{[^{}]*name\s*:\s*['"]contract|\{[^{}]*test\s*:\s*\{[^{}]*name\s*:\s*['"]contract['"][^{}]*\}[^{}]*extends\s*:\s*false``
- Informational: this is nearly the same scenario as the existing `tools/bench/tasks/vitest-extends` (same change, root setup file vs. a new project). If both sets are reported, change 14's C result is not independent of that task.

Checked and fine: vitest-5-0-0-9-c, vitest-5-0-0-16-c. For both, the traps are confirmed in source and the rules accept the correct variants I tried and reject the stale ones. All other tasks have true traps, fair prompts apart from the notes above, and consistent overlays apart from finding 6.
