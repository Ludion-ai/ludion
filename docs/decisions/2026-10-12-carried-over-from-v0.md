## Carried over from v0

These describe the system as built through 2026-10-08 and stay true unless a v2 decision above changes them.

### Conventions

- TypeScript strict, Node 24 LTS (`.node-version`, used by CI and the deploy job), npm workspaces.
- Vitest 4 everywhere, pinned until `@cloudflare/vitest-plugin` supports a newer major, so Worker tests run inside workerd with the real `ASSETS` binding over the built site.
- Playwright for end-to-end checks and the axe check on every page.
- Code outside `tools/` and build scripts uses only web-standard APIs (fetch, Web Crypto, Streams); Node-only APIs are allowed in `tools/` and build scripts.
- npm scripts are written in Node so they run on Windows and Linux; no bash-only commands.
- Small functions; no abstraction before the third use.
- Errors say what happened and what to do next, in plain words.
- Names in user language: teach, ask, lesson, teacher, sign, verified, checking.
- Commit messages and PR titles in English, imperative.

### Infrastructure

- One Cloudflare Worker, `ludion` (Hono), serving the prerendered Astro site from `apps/site/dist` as static assets, `/index.json`, and `/mcp`. Custom domain `ludion.ai` in `wrangler.jsonc`. `run_worker_first` covers `/mcp`, `/mcp/*`, and `/@*`; `/@<login>` serves `/teachers/<lowercase login>/` from the assets, or the 404 page. (`/api/*`, `/auth/*`, and the `SOURCE_CHECK_LIMITER` binding were removed with format 1.)
- No content database (no KV, D1, or R2): GitHub is the database, and the index is rebuilt with every deploy.
- **Deploys** happen only in `.github/workflows/deploy.yml`:
  - Triggers: every push to `main`, and `workflow_dispatch`.
  - Environment `production` (main only), `contents: read`, one deploy at a time, and a running deploy is never cancelled.
  - Steps: checkout with `fetch-depth: 0`, typecheck, build, test, `npx wrangler deploy` with the repo's own wrangler (no wrangler-action), then `tools/check-production.ts`. The check needs the new `built_at` within 2 minutes, `/mcp` initialize answering 200, and `ludion_ask` about distutils returning "Taught by @"; any failure fails the job.
  - Actions are pinned to commit SHAs.
  - The build gets the job's own read-only token as `GITHUB_READ_TOKEN`, for teacher login lookups; it is never shipped in `dist/` or logged.
- **No preview deployments**: a Worker's secrets are shared by every version of it, so a preview would run with production's secrets. `wrangler.jsonc` has no `env` blocks. Workers Builds is disconnected.
- To deploy again, start a new run from main (`gh workflow run deploy.yml --ref main`); a rerun of an old run fails the newest-commit check (see "Deploy safety").
- `CLOUDFLARE_API_TOKEN` is currently a repository secret; the owner was advised to move it to the `production` environment. `CLOUDFLARE_ACCOUNT_ID` is an environment secret.
- **Branch protection on main**:
  - PRs are required, with 0 approving reviews because there is one maintainer; set it back to 1 when a second maintainer joins.
  - Required checks `verify` and `test`, pinned to the GitHub Actions app (app id 15368) so a status from anywhere else can't satisfy them. "Up to date before merging" is off.
  - Administrators are included; force pushes and deletion are blocked.
  - Squash merge only, auto-merge on, head branches deleted after merge.

### Lessons and the index

- One file per lesson: `lessons/<subject>/<id>.json`, id a ULID, subject `^[a-z0-9][a-z0-9.-]{0,63}$` (also the directory). Canonical JSON (`formatLesson`: keys in schema order, absent optional fields omitted, 2-space indent, trailing newline); CI rejects anything else.
- The active set: all lessons on main minus every id named in another lesson's `replaces`.
- `index.json` (`{version: 1, built_at, lessons, teachers}`) is built from the active set at site build. Each lesson carries:
  - `teacher`: the current login for `teacher_id`, looked up by numeric id with `GET /user/{id}` once per id per build, falling back to the login stored in that teacher's newest lesson;
  - `verified_by`: `proof` if any Lean run, else `test` if any run, else `source` (format 1 adds `differential`; see "Lesson format 1");
  - `verified_at` and `pr`: from the git commit that added the file, where `pr` is parsed from the squash message's `(#n)` and a shallow clone is unshallowed first;
  - the lesson's GitHub URL.
- `teachers` is keyed by `teacher_id` (as a string). Lessons are sorted newest first, and the build warns above 5 MB. `index.json` is open to every origin (`Access-Control-Allow-Origin: *`), on purpose: the lessons are a commons.
- The Ajv validator is compiled ahead of time into `packages/core/src/generated/validate-lesson.js` (`npm run gen:validator`), because Workers forbid runtime code generation; a test fails if it is stale.

### CI (`verify.yml`, `test.yml`, `reverify.yml`)

- `verify` runs on every PR. It never uses `pull_request_target`, and it has no path filter, because a required check that never runs would leave PRs waiting forever.
  - It runs with `contents: read`, no secrets, and checkout with `persist-credentials: false` and `fetch-depth: 0`.
  - A PR that touches no lesson passes at once.
  - A lesson PR may change only `lessons/<subject>/<id>.json` files:
    - added ones are validated against the **base branch's** schema (read with `git show origin/<base>:…` and compiled at run time, so a PR can't loosen what it is checked against) and canonical form; their path is checked, `replaces` is checked against the base branch's active set, `run` evidence runs in Docker, and `source` evidence is checked;
    - deleted ones are retractions (label `retract`);
    - modified ones fail ("Lessons are immutable").
- **Trust boundary**: `verify.yml` checks the base commit out to `.verifier` and runs `node .verifier/tools/verify/src/pr-cli.ts`, so the checker is the base's `tools/verify`, not the PR's copy. (Replaces: verify ran the PR's own checker.) Lesson files are still read from the PR checkout. A human reviews before merging.
- **Isolated verifier deps** (`verifier-deps.ts`): `verifierDepsDir` is `ludion-verifier-deps-<first 16 hex of the lockfile sha256>` under a caller-chosen directory, and `buildVerifierDepsInstall` is `npm ci --ignore-scripts --no-audit --no-fund` there. That directory is isolated only when it and the recipient tree do not contain each other. On a run, `buildDockerRunArgs` bind-mounts it at `/verifier:ro` (the `:ro` is literal, not an option). The install phase refuses `verifierDeps`, and the mount may not overlap the work folder. `runInDocker` does not set it. Every bind-mount source (the install work directory, a run-phase `node_modules` or `site` directory, and the verifier deps) is realpath'd and must sit inside `realpath(os.tmpdir())` or, when that variable is set, `realpath(RUNNER_TEMP)`. The run phase does not bind-mount the work directory itself. `/w` there is a tmpfs, and the only work-folder binds are those install-result directories, read-only, when they exist. A source with a top-level `.git`, or one inside a git work tree below that root, is rejected, so `.git` is never mounted. That is the primary control. The write-check `.git` patterns are a secondary layer. `verify.yml` still checks the base out to `.verifier` inside the PR checkout and runs `npm ci --ignore-scripts` on the base lockfile there, so `results.json` reports `verifier.isolation.isolated: false` and `trusted: false` until a separate `.github` change moves that checkout (for example to `runner.temp`).
- **`results.json`** (`pr-cli.ts`) gains `verifier` beside `results` and `labels`, which are unchanged. `verifier` is `node_version`, `isolation` (a boolean and a fixed reason, with no path), `trusted`, and either `verifier_runtime` or `unavailable_reason`. When isolation fails, `trusted` is false, `verifier_runtime` is null, and `unavailable_reason` is `not_isolated`: the loaded vitest is not recorded. When isolation holds, `trusted` is true only if `verifier_runtime` validates. That object is exactly `vitest_location: "verifier_store"`, `vitest_realpath` (`/verifier/` plus the path under the verifier store, forward slashes, no host path; the rest is non-empty, has no empty segment and no trailing slash, is well-formed, and has no `\`, `%`, `//`, control character, or `.` or `..` segment; at most 400 characters), `vitest_version` (SemVer 2.0, including a prerelease), `vitest_integrity` (`sha512-`, 86 base64 characters, and `==`), and `lockfile_sha256` (64 lowercase hex, no `sha256:` prefix). The expected hash is `git show HEAD:package-lock.json` in the verifier checkout (an argv array, shell off), so a dirty working tree does not match. A read failure is a fixed code (`vitest_unreadable`, `lockfile_sha256_mismatch`, `vitest_integrity_missing`, and the others in `verifier-deps.ts`), never a filesystem message. `validateVerifierRuntime` copies the checks from `packages/capability/src/schema.ts` at `078f89d6254d1428e95c973bffacf7b474f47ac8` and does not import that package. The object has exactly those five keys.
- **Runner-owned vitest argv** (`vitest-argv.ts`): `buildVerifierVitestArgv` is the command: `vitestPath`, `run`, `--allowOnly=false`, `--config=<configPath>`, `--root=<recipientRoot>`, `--reporter=json`, `--outputFile=<reportPath>`, one `--testNamePattern=<value>` when a pattern is set, then the files. `configPath` is required and is the runner file `tools/verify/runner/vitest.runner.config.mjs` (no imports, no setupFiles, no globalSetup, no plugins, no projects, no workspace). It must sit inside the verifier root and outside the recipient tree. `reportPath` is required, absolute, and outside the recipient tree. An artifact argv may only narrow this: an optional leading `vitest`, an optional `run`, file filters, and one `-t` / `--testNamePattern` / `--testNamePattern=<pattern>`. A second pattern is rejected. The pattern is one string of 1 to 256 characters, not starting with `-`, with no NUL or newline. A file filter matches `^[A-Za-z0-9._@+/-]+$`, at most 256 characters, not starting with `-` or `/`, with no `..`, `//`, or backslash. A command check compares the whole token's basename, so `node/foo.test.ts` and `bash.test.ts` are files. `--reporter` and `--outputFile` are rejected on an artifact. `judgeVitestReport` reads the vitest 4 JSON reporter. It passes only when `success` is true, a test actually ran, the required list is non-empty, and every required test's status is exactly `passed`. The required file matches the report path by a normalized suffix (`\` becomes `/`, then equality or a `/` boundary). Not called from a runner yet (entry point for the P1 capability runner).
- **Post-run write check** (`write-check.ts`): snapshot before and after with `lstat` (a symlink is an entry, not a walk; `.git` is included). Each entry records `mode` (`st.mode & 0o7777`), and a regular file records `nlink`. A mode change is a change. A changed or added regular file with `nlink > 1` is a hard link. Then `realpath` every change. Rejects, in order, a symlink, a path outside the root, a hard link, a protected path, and a write that matches no declared glob. Protected paths (`DEFAULT_PROTECTED`) include `.git/**`, `**/.git/**`, and `**/.git` (secondary; `.git` is never mounted), `**/.gitmodules`, `**/.husky/**`, `.ludion-verify/**`, `tools/verify/**`, `.github/**`, `node_modules/**` and `**/node_modules/**`, `package.json` and `**/package.json`, lockfiles (`package-lock.json`, `**/package-lock.json`, `npm-shrinkwrap.json`, `**/npm-shrinkwrap.json`, `pnpm-lock.yaml`, `**/pnpm-lock.yaml`, `yarn.lock`, `**/yarn.lock`, `bun.lockb`, `**/bun.lockb`), vitest and vite config at the root and nested (`vitest.config.*`, `vitest.workspace.*`, `vitest.projects.*`, `vite.config.*`, and the `**/` forms), setup files (`**/vitest.setup.*`, `**/vitest-setup.*`, `**/setupTests.*`, `**/test-setup.*`, `**/test/setup.*`), `tsconfig.json` and `**/tsconfig*.json`, `.npmrc` and `**/.npmrc`, `**/.yarnrc`, `**/.yarnrc.yml`, `**/.yarnrc.yaml` (not `**/.yarnrc*`, which would also match `.yarnrc.test.ts`), `**/.pnpmfile.cjs`, and `**/bunfig.toml`. Matching lowercases the path and the pattern on every OS. A declared glob does not excuse a protected path or a hard link. Not called from a runner yet.
- Author rule: a person's PR must have `author_id` equal to the PR author's numeric id. Any bot fails (the App bot rule was removed with format 1).
- **Runners**: `python` (`python:3.14-slim`), `bash` (same image), `node` (`node:24-slim`), `lean` (none yet: label `needs-lean`). Other schema runtimes use the matching `node:<version>-slim` or `python:<version>-slim` pin.
  - Every `docker run` argv comes from `buildDockerRunArgs`. The options object is closed (`phase`, `runtime`, `name`, `workDir`, `packages`, `verifierDeps`, `installStep`); any other key throws. `installStep` is `npm-lock`, `npm-ci`, or `pip`, required for install and rejected for run. Tests check that the hardening flags cannot be dropped or overridden.
  - Both phases pass `--cap-drop ALL`, `--security-opt no-new-privileges`, `--read-only`, `--memory 512m`, `--cpus 1`, `--pids-limit 256`, and `--user` with a numeric non-root uid:gid (the host uid and gid when both are non-zero integers, otherwise `1000:1000`). The temp work folder is mode `0777` only in that fallback. Both phases pass `--tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m`. The run phase always adds `--network none`. When it has a work directory, `/w` is `--tmpfs /w:rw,noexec,nosuid,nodev,size=128m,mode=1777` (writable scratch, not host-backed). The only binds from that directory are read-only install results, and only when the directory exists: `node_modules` for node and `site` for python, with `:ro` appended by `buildDockerRunArgs`. The run phase does not bind-mount the work directory itself. The install phase adds no network flag and bind-mounts the work folder writable at `/w`.
  - Images are `tag@sha256:…` from `IMAGE_DIGESTS` in `docker.ts`: OCI index digests (not single-platform manifests) taken from the Docker Hub registry API (`Docker-Content-Digest`). `pullImages` refuses an image that is not pinned. Moving to a new release means updating the digest in code, which is reviewed because `tools/verify/` is protected. Images are pulled before any timed run. Lessons that break show up in reverify.
  - Code arrives on stdin; exit 0 means the claim holds; a `skip:` line means the runner can't test it.
- **Source checks** (`checkSource` in `packages/core`, `src/safe-fetch.ts` in `tools/verify`):
  - The URL, judged as `new URL()` parses it, on the first request and on every redirect target:
    - `https:` only, default port, no user name or password;
    - no IP-address hosts;
    - refuse single-label names, `localhost`, and names ending in `.localhost`, `.local`, `.internal`, `.home.arpa`, `.test`, `.invalid`, `.example`, `.onion`.
  - Redirects are followed by hand, at most 3.
  - Only `text/html`, `text/plain`, or `application/xhtml+xml`; at most 2 MB, within 5 seconds; `User-Agent: LudionBot/0.1 (+https://ludion.ai/bot)`.
  - The page and the quote are normalized the same way (tags, entities, NFKC, case, whitespace, quotes and dashes), and the page must contain the quote.
  - **Never pass the global `fetch` to source checks on a machine that can reach private networks.** The CI fetch resolves the name itself and refuses the name if any address is non-public, then connects to exactly that address (no DNS rebinding). Non-public:
    - IPv4 `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.88.99/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4`, `240/4`;
    - IPv6 outside `2000::/3`, plus `2001::/23`, `2001:db8::/32`, `2002::/16`.
  - This matters again in v2, where `ludion teach` checks sources on the teacher's machine.
- Labels (`skipped`, `needs-lean`, `retract`) are set by a separate `label` job (`pull-requests: write`) that only reads the results artifact and never runs lesson code; on fork PRs its token is read-only and it logs and exits 0.
- `test`: typecheck, build (first, because the Worker tests serve the built site), Vitest (Node and workerd projects), and Playwright with axe on every page in both themes.
- **`reverify.yml`**: see "Nightly reverify" under the v2 decisions.

### Search and MCP

- `/mcp` is MCP over Streamable HTTP, stateless (`createMcpHandler` from `agents/mcp/server` with `McpServer` from the v2 MCP SDK), open to any origin and accepting no credentials. The index is loaded through `ASSETS`, kept in module scope by `built_at`, and revalidated at most every 60 seconds.
- Server name `ludion`. Server instructions, exactly: "Ludion holds lessons that people taught and machines verified by test, proof, or cited source. Use ludion_ask before answering questions about specific software behavior, versions, or recent changes, and cite the teacher. Use ludion_teach only when the user asks to teach or corrects you with evidence."
- `ludion_ask`:
  - Input: `question` (1 to 8,000 characters), `subject?`, and `k?` (1 to 10, default 5). The description of `question`, exactly: "The user's question or the exact error message, in English. Include the library or tool name and its version if you know them."
  - Tool description, exactly: "Search lessons that people taught Ludion and machines verified by test, proof, or cited source. Use before answering questions about specific software behavior, APIs, versions, tools, or anything that may have changed recently. Each result names its teacher; cite them."
  - Annotations `readOnlyHint: true`, `openWorldHint: false`.
  - Output: the data line, the coverage line (added 2026-10-12), then one block per lesson (`N. <claim>` / `   Taught by @<teacher>. Verified by <test|proof|source> on <YYYY-MM-DD>. Applies to <subject> <version>.` / `   <lesson URL>`), plus `structuredContent: {lessons: [{id, subject, version, claim, teacher, teacher_id, verified_by, verified_at, lesson_url}]}`.
  - No match, exactly: "No lesson yet for this. <COVERAGE_LINE> If you know the answer and can show evidence (a test or a source with a quote), teach it with ludion_teach." (The coverage sentence was added 2026-10-12; see "Partial coverage, said everywhere".)
  - `ludion_teach` is not on main (it was in #13); v2 brings back a version that validates a draft and returns the `npx ludion-ai teach` command.
- **Search** returns a lesson only on a strong match:
  - a strong word: an identifier, version number, flag, pseudo-class, a word in capitals or camelCase, or any word not on the common-word list;
  - when the question has no strong word, two common words;
  - a word the lesson writes as code, plus one more word of the question.
- Subject names never count. Long pastes are searched by their last error line and strong words.
- `packages/core/test/search-eval.test.ts` holds the eval: off-topic and subject-only questions find nothing; error messages and mixed Japanese find their lesson; on-topic questions find it in the top 3 at least 90% of the time.

### Site

- Astro, static. All UI strings live in `apps/site/src/strings/en.ts`.
- Design B: black and white with no hue; Schibsted Grotesk and JetBrains Mono (ligatures off). The verified seal names its evidence (`exit 0`, `proved`, `quote found`). Every page with a pool has a water surface under its top rule (WebGL2; reduced motion shows one still frame); see "Water on every page". Tokens live in `apps/site/src/styles/tokens.css`.
- Design changes are checked against the sample lessons in `apps/site/samples/`, built only with `LUDION_SAMPLES=1` into `dist-samples`. They are never deployed: the build refuses that flag in Cloudflare.
- Budgets:
  - WCAG 2.2 AA in both themes;
  - axe (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`) finds nothing on any page;
  - home JavaScript at most 60 KB gzipped;
  - targets that no test or workflow checks yet: Lighthouse accessibility at least 95, LCP at most 1.5 s on a mid-range phone over 4G, CLS at most 0.05. axe and the 60 KB budget are enforced (`e2e/`).
- Headers (`apps/site/public/_headers`): CSP `default-src 'self'` (avatars from `avatars.githubusercontent.com`; Google Analytics' origins, see "Analytics"), `frame-ancestors 'none'`, `nosniff`, `strict-origin-when-cross-origin`, and a locked-down `Permissions-Policy`. Canonical links use the trailing slash.

### Bench

- `tools/bench` runs questions through Claude Code headless in a new empty folder with a run-only configuration: `--setting-sources project` in an empty folder, `--strict-mcp-config`, and only the condition's tools. It saves raw logs and stops before a spending cap, and a separate tool-less judge grades the answers.
- Method used on 2026-10-08, proposed in #19 (never merged):
  - changes from changelogs with dates and URLs, each with a quote that passes `checkSource`;
  - an A question (seed) and a B question (measurement) per change, with answer keys; seeds come only from A, measurement only from B;
  - conditions none, web, and ludion;
  - an LLM judge, with at least 10% of grades read by hand;
  - limits on runs, turns, and dollars written before each run.
- Results:
  - `docs/bench/2026-10-08/` (FreshBench v0). One answer key there, WebdriverIO, is known to be wrong and will be fixed against primary sources.
  - `docs/experiments/e1/` (ask rate).


