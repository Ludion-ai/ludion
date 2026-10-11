**Fresh-context review (subagent) of the wrangler C tasks: approve with fixes**

Scope: the 12 folders `tools/bench/tasks-c/wrangler-*-c`. Each trap was checked against the installed wrangler 4.148.0 in the prepared project (`node_modules/wrangler/wrangler-dist/cli.js`, `config-schema.json`, `node_modules/miniflare`). I tested the proposed replacement regexes in Node against the cases listed. `npx vitest run tools/bench` passes (51/51).

Skipped changes, not reviewed as tasks: 4-121-0-6, 4-116-0-16, 4-117-0-20. All three are additive or transparently rewritten, so skipping them is reasonable.

## Findings (most severe first)

### wrangler-4-145-0-11-c (medium): rules reject a correct solution
The `basin sql query` handler reads `WRANGLER_BASIN_SQL_AUTH_TOKEN` and falls back to `CLOUDFLARE_API_TOKEN` from the process env (cli.js ~213499). So this step works:

```yaml
env:
  CLOUDFLARE_API_TOKEN: ${{ secrets.R2_SQL_TOKEN }}
```

It does not use the forbidden *secret* `CLOUDFLARE_API_TOKEN`; it only puts the R2 token into that env var. The same goes for a stale-looking step that sets both `WRANGLER_R2_SQL_AUTH_TOKEN` and `CLOUDFLARE_API_TOKEN` from `secrets.R2_SQL_TOKEN`: it works on 4.148.0. Today both are graded wrong.

**Fix:** add a second alternative:
```json
[
  { "files": [".github/workflows/nightly-report.yml", ".github/workflows/nightly-report.yaml"], "pattern": "CLOUDFLARE_API_TOKEN[\"']?\\s*[:=]\\s*[\"']?\\$\\{\\{\\s*secrets\\.R2_SQL_TOKEN\\b" },
  { "files": [".github/workflows/nightly-report.yml", ".github/workflows/nightly-report.yaml"], "pattern": "secrets\\.CLOUDFLARE_API_TOKEN\\b", "absent": true }
]
```
The plain stale answer (only `WRANGLER_R2_SQL_AUTH_TOKEN`) still fails.

### wrangler-4-129-1-9-c (low): the 64 MiB rule misses the form wrangler itself uses
Wrangler's own constant is `MAX_UNCOMPRESSED_SIZE_BYTES = 64 * ONE_KIB_BYTES * ONE_KIB_BYTES` (cli.js 163205). An assistant that copies it under a name without "max"/"limit" fails the first rule, for example `const UNCOMPRESSED_CAP = 64 * KIB * KIB`. The 64 MiB check is correct, but the rule doesn't recognise it.

**Fix:** append one more alternative to the first rule's pattern:
`|\\b64\\s*\\*\\s*[a-z_]*kib\\w*\\s*\\*\\s*[a-z_]*kib\\w*`
This matches `64 * ONE_KIB_BYTES * ONE_KIB_BYTES` and `64 * KiB * KiB`.

### wrangler-4-141-0-10-c (low): the package.json rule can be satisfied by a different script
`"deploy"\s*:\s*"[^\n]*--durable-objects-code-update-mode...` lets `[^\n]*` run past the end of the `deploy` value. The template's `scripts` object is on one line. If an assistant adds a separate script on that line, such as `"deploy": "wrangler deploy", "deploy:now": "wrangler deploy --durable-objects-code-update-mode immediate"`, it is graded correct even though `npm run deploy` is unchanged (verified). Alternative 3 has the same problem.

**Fix:** keep the match inside the JSON string value. Use this in alternative 1:
`"\"deploy\"\\s*:\\s*\"(?:[^\"\\\\\\n]|\\\\.)*--durable-objects-code-update-mode[= ]+(\\\\\"|')?immediate\\b"`
Make the same `[^\n]*` → `(?:[^"\\\n]|\\.)*` swap in alternative 3. Both correct examples still pass; the cross-script case now fails.

### wrangler-4-111-0-0-c (low): same spanning problem, and single quotes are rejected
- `[^\n]*` in the `deploy:staging` rule can reach a later script on the same line. For example, `"deploy:staging": "wrangler deploy", "tail:staging": "wrangler tail --env staging"` is graded correct.
- `wrangler deploy --env 'staging'` is graded wrong.

**Fix:** use
`"\"deploy:staging\"\\s*:\\s*\"(?:[^\"\\\\\\n]|\\\\.)*((--env|-e)[= ]+(\\\\\"|')?staging|CLOUDFLARE_ENV=staging)"`
It accepts `--env staging`, `-e=staging`, `--env 'staging'`, `--env \"staging\"` and `CLOUDFLARE_ENV=staging`, and rejects the cross-script case (verified).

Nit, no change needed: the prompt says production deploys "must keep working as before", but on 4.148.0 the untouched config already fails validation because of `legacy_env`. That fits a project that was just upgraded, and it doesn't hint at the answer.

### wrangler-4-118-0-8-c (low): one correct route is not accepted
Wrangler loads `.env` and `.env.local` into its own process env by default (cli.js 186222, 361402), so the three alternatives are right. If the dev script passes `--env-file <path>`, wrangler loads that file instead of the defaults. So `"dev": "wrangler dev --env-file .env.dev"` with `X_LOCAL_OBSERVABILITY=false` in `.env.dev` works but is graded wrong. This is rare.

**Optional fix:** add alternatives for `.env.dev` and `.env.development`, using the same pattern as the `.env` alternative.

I also confirmed the rules are right to reject a solution that only sets `X_LOCAL_EXPLORER=false`. Miniflare attaches the observability collector whenever `unsafeObservability` is true, whether or not the Local Explorer is on (miniflare index.js ~111780). There is also no config-file switch for it.

### wrangler-4-121-0-7-c (nit)
- The rules use the same `[^\n]*` pattern. It is harmless here, because nothing else in the template contains `d1 create`, `orders` or `--jurisdiction`. The same swap as above would make it strict.
- The sentence "(We're an ordinary commercial company, not a government agency.)" is there to rule out `fedramp`, which would also keep the data in the US. It hints that more than one US option exists, but it doesn't name `us`. Acceptable.
- Verified: `d1 create --jurisdiction` has choices `eu`, `fedramp`, `us` and no short alias.

## Checked and fine
- **wrangler-4-113-0-21-c:** KV `id` is optional in validation, and `--experimental-provision` defaults to true. The id-less-binding rule is sound.
- **wrangler-4-122-0-2-c:** `NODEJS_COMPAT_DEFAULT_ON_DATE = "2026-08-04"`, and wrangler itself adds both `no_nodejs_compat` and `no_nodejs_compat_v2` to opt out.
- **wrangler-4-124-0-4-c:** in 4.148.0, `--latest` uses `DEFAULT_COMPAT_DATE` (the workerd release date). `--compatibility-date` has no alias, and all three alternatives are sound.
- **wrangler-4-125-0-19-c:** the `connect` schema is `{protocol: "tcp"|"udp", port: number, address?}`. The rules don't require the `experimental` compatibility flag; that is lenient, but the stale answer still fails.
- **wrangler-4-127-0-17-c:** `concurrency` allows only `limit` (a positive integer), so the strict `{ "limit": 5 }` regex is right.
- **wrangler-4-148-0-24-c:** `versions secret bulk` deletes keys whose value is `null`. `versions upload --secrets-file` is additive ("omitted secrets will not be deleted"), so it is not a missed alternative.
- With the fixes above: wrangler-4-111-0-0-c, wrangler-4-118-0-8-c, wrangler-4-121-0-7-c, wrangler-4-129-1-9-c, wrangler-4-141-0-10-c, wrangler-4-145-0-11-c.

In all 12 tasks, the trap matches the installed 4.148.0 and the overlay is consistent with the prepared project and the prompt.
