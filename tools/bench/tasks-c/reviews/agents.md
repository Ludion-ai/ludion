**Fresh-context review (subagent) of the agents C tasks: approve with fixes**

Scope: the 12 folders `tools/bench/tasks-c/agents-*-c`. For each one I checked the trap against the keys and against the installed agents 0.27.0 (`node_modules/agents/package.json` exports and peers, the shipped `docs/*.md`, `dist/*.d.ts`, and `dist/chat/react.js`, `dist/client-1tEQ1Oqz.js`, `dist/cli.js`). All 12 traps hold in the installed version, and all overlays match the prepared project. The overlay APIs in 27-0-2 are real: `Channels.forHarness`, `WebChannel`, `web`, `AiSdkHarness`, the default `/channels` path. `npx vitest run tools/bench` passes: 51 tests.

Exact patterns below are written as JSON strings, so they can be pasted into task.json as they are.

## agents-0-27-0-2-c

1. **The prompt lets a working solution be graded wrong (medium).** The change only adds a feature. The prompt asks for "an npm script `chat` that does that", so a hand-written terminal client that really speaks the Web Channel protocol is a correct answer to the request as written. The rule still grades it wrong. The protocol types ship in `dist/experimental/channels/web/index.d.ts`, so a careful assistant can write such a client. Fix: add one sentence to the prompt that rules out custom client code without naming the CLI: "Don't write a client script yourself; use something that already ships with our dependencies."
2. **The regex misses some correct spellings (low).** `npx agents@0.27.0 tui …` fails, and so does `node node_modules/agents/dist/cli.js tui …`. Replacement pattern:
   `"\"chat\"\\s*:\\s*\"[^\"]*(?:\\bagents(?:@[\\w.^~-]+)?|agents/dist/cli\\.js)\\s+tui\\b"`

## agents-0-22-0-13-c

3. **The rules reject an equivalent API and accept a broken one (medium).** `docs/lifecycle.md` shows `new Lifecycle(this)` plus `this.lifecycle.installHandlers()` as the expanded equivalent of `Lifecycle.install(this)`. The rule only accepts `Lifecycle.install(`. The rules also never check that the Scheduler is installed, so `Lifecycle.install(this)` without `.use(this.scheduler)` passes even though the scheduler then has no storage and no alarm. `Lifecycle.use()` is the only way to add a capability (see `durable-object-lifecycle-*.d.ts`). Fix:
   - Replace the Lifecycle rule pattern with `"\\bLifecycle\\s*\\.\\s*install\\s*\\(|\\bnew\\s+Lifecycle\\s*(?:<[^>]*>)?\\s*\\("`.
   - Add the rule `{ "files": ["src/counter.js"], "pattern": "\\.\\s*use\\s*\\(" }`.
   - Add a wrong example that has `Lifecycle.install(this)` with no `.use(...)`.

## agents-0-22-0-14-c

4. **The same Lifecycle problem (medium).** Make the same two changes as finding 3, using `src/gateway.js`. Without `.use(this.mcp)`, the manager has no `this.lifecycle.storage`, so a solution that only calls `Lifecycle.install(this)` is broken but passes today.
5. **The `storage:` rule rejects a solution that works (low, judgment call).** The 0.27 `MCPClientManager` constructor reads only `options.env` and `options.createAuthProvider` (`dist/client-1tEQ1Oqz.js`). An extra `{ storage: this.ctx.storage }` is silently ignored in this JS project. So the second wrong example, which has `Lifecycle.install(this).use(this.mcp)` plus the dead option, runs correctly but is graded wrong. Once the `.use(` rule from finding 4 is in, the Lifecycle and `.use` rules already tell the stale solution apart. Recommended: drop `{ "pattern": "\\bstorage\\s*:", "absent": true }`, and move that second wrong example to `correct` (or delete it). If you keep the rule, say in `trap` that a dead `storage` option counts as stale on purpose.

## agents-0-25-0-3-c

6. **The `newUniqueId` rule rejects a correct solution (low to medium).** Using `env.Report.newUniqueId().toString()` as the instance name with `getAgentByName(env.Report, name)` is correct: the instance is addressed by name. The blanket rule `\bnewUniqueId\s*\(` absent grades it wrong, and an assistant looking for "a new unique id" could plausibly write it. Fix: replace that rule's pattern with `"\\bnewUniqueId\\s*\\(\\s*\\)(?!\\s*\\.\\s*toString\\s*\\()"` (still absent). It still catches the stale `const doId = env.Report.newUniqueId(); env.Report.get(doId)` and `env.Report.get(env.Report.newUniqueId())`. Add a correct example with `getAgentByName(env.Report, env.Report.newUniqueId().toString())`. Nit: `\bgenerate\s*\(` always matches the method definition when `Report` sits in `src/index.js`, so it checks nothing. `"\\.\\s*generate\\s*\\("` would at least require a call.

## agents-0-20-0-18-c

7. **Only two file names are accepted (low to medium).** Correct solutions that put the factory or the handler in `src/mcp-server.js`, `src/server.js`, `src/mcp/index.js`, `src/mcp/server.js` or `src/tools.js` are graded wrong. Fix: add alternatives that mirror alternatives 2 and 3 for each of those paths. Each needs `from\s*["']@modelcontextprotocol/server["']` in the file and `@modelcontextprotocol/sdk` absent in both that file and `src/index.js`. Alternative 2's shape (handler in `index.js`, server in the helper) and alternative 3's shape (handler in the helper) both apply. "Avoid deprecated APIs" is a mild cue, but it is needed: the v1 overload still works, so without it the stale answer would not be wrong.

## agents-0-21-0-16-c

8. **Only three helper file names are accepted (low).** A wrapper module named `src/observability.js`, `src/lib/ai.js`, `src/traced-ai.js` or `src/instrumented-ai.js` fails. Fix: add one alternative with these rules:
   - `{ "files": ["src/ai.js","src/tracing.js","src/telemetry.js","src/observability.js","src/lib/ai.js","src/lib/tracing.js","src/traced-ai.js","src/instrumented-ai.js"], "pattern": "\\bwrapAISDK\\s*\\(" }`
   - the same files list with `"[\"']agents/observability/ai[\"']"`
   - `{ "files": ["src/summarize.js"], "pattern": "from\\s*[\"']\\.{1,2}/[^\"']+[\"']" }`
   - `createAISDKTelemetry` absent in `src/summarize.js`

   The same alternative could replace the three per-file ones.

## agents-0-27-0-0-c

9. **The list of files is closed (low).** A correct solution that keeps every channel import in an unlisted file (`src/slack-channel.js`, `src/slack-gateway.js`, `src/channels/slack.js`, `src/channels/index.js`, `src/webhooks.js`) and imports only local modules from `index.js` is graded wrong. A stale `agents/channels` import in such a file also escapes the absent checks. Fix: add those five paths to the absent list of every alternative, and add one positive alternative for each.

## agents-0-23-0-7-c

10. **The prompt copies the new docs' wording (low, does not affect grading).** It nearly repeats the code comments in `docs/sub-agents.md` Overview: "its own isolate and its own SQLite database, colocated with and supervised by", and "Stops the child immediately; its storage survives for inspection". It also repeats the doc example's `execute` and `runId`. Either arm can grep that passage, so both find the answer easily and the task tells less apart. Suggested rewording: "Each run must be sandboxed in a child of that Chat instance with its own separate storage, reachable only through the Chat instance and without a wrangler binding of its own. … `cancel <runId>` stops that run right away but keeps its data so we can debug it." The rules are fine. Aliasing (`const d = this.dynamicAgents; d.get(`) would be missed, but that case is negligible.

## agents-0-22-0-11-c

11. **An alias is not accepted (low).** `experimental_throttle: false` is not accepted. In `dist/chat/react.js`, `resolveChatThrottleMs` passes `throttle ?? experimental_throttle` through, so `false` reaches `useChat` as a falsy throttle, which turns throttling off. It is the deprecated alias spelled oddly, so accepting it is optional. Pattern: `"\\bexperimental_throttle\\s*:\\s*(?:false|0)(?![\\w.])"`.

Checked and fine: agents-0-19-0-21-c, agents-0-24-0-5-c, agents-0-24-0-6-c. Traps and overlays are also fine for all the tasks listed above.

- agents-0-19-0-21-c: the peer range is `ai: ^6.0.0 || ^7.0.0`. An optional `"*"` could be accepted.
- agents-0-24-0-5-c: `getConnection` and `getConnections` exist on Agent in 0.27. A `getCurrentAgent().connection ?? this.getConnection(id)` fallback would be graded wrong; that is rare and acceptable.
- agents-0-24-0-6-c: per `docs/client-sdk.md`, state sync and reconnection work the same on `capnweb`, so the prompt's requirements hold.
