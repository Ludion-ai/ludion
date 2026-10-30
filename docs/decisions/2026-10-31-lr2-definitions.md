# 2026-10-31 (LR2) — What else the LR Dockerfiles show, and how many of them Ludion could keep patched with no person. Definitions fixed before counting

LR (docs/decisions/2026-10-30-lr-dockerfile-lag-definitions.md) measures how far public Dockerfiles that pin the official php or node image lag behind security releases. LR2 reads a few more small files from the same repositories and counts five more things: whether the project has tests, whether its image looks buildable with no network, whether its start can be checked (EXPOSE, HEALTHCHECK), whether a merge deploys it automatically, and whether its runtime is past end of life. It also counts what share of them the Ludion of today could keep patched with no person involved, and with what 95% interval.

**This is a measurement. It changes no product code**, gate, wait table, CLAUDE.md, docs/design.md or docs/status.md.

This entry is committed and pushed before any repository is chosen or counted, and before any file named below is read. At this commit the LR code search has finished (all 280 pages, raw/search-pages.tsv) and nothing else has run. LR's entry is not edited; where this entry adds to it, it says so. A later change is a new entry with its reason.

## 1. The sample: one repository per owner (adds to LR section 6)

The share in section 4 needs independent samples. LR's walk (section 6.3) takes each repository once but can take several from one owner. One rule is added to the walk, checked after the owner exclusions and before the repository's metadata is read: **a repository whose owner (compared case-insensitively) already has a chosen repository, in either stratum, is skipped** (`rejected:owner-already-chosen`). Everything else in LR section 6 is unchanged: the pool, the order by SHA-256, the other checks, 50 php then 50 node, and a smaller n if a stratum runs out.

So n = 100 repositories from 100 different owners, which meets the 97 that n = z²·p(1−p)/e² gives for p = 0.5, e = ±10% and 95% (z = 1.96: 96.04, rounded up). The LR lag numbers are counted on this same sample.

## 2. What is read (adds to LR sections 5 and 7)

For each chosen repository, from its default branch at the time of reading, through the GitHub contents API, one file or directory listing per request:

- the measured Dockerfile (LR section 6.3), whole;
- the listing of the root and of the measured Dockerfile's directory;
- the listing of `.github/workflows`, and each entry of it whose name ends in `.yml` or `.yaml`, in ascending name order, at most 50 (the number of such files is logged, so a repository with more shows it);
- the stratum's manifest, `composer.json` for php and `package.json` for node, in the measured Dockerfile's directory and at the root (once when they are the same);
- the files LR section 5 reads.

Nothing is cloned and no archive is downloaded. The time each repository is read is logged. LR's measurement date (2026-10-30, the date its collection started) is kept for every day count, including the 365-day `pushed_at` rule; the files are read later than that date and the report says when.

**How contents are handled (a change of method, not of what is counted).** The contents API returns a file base64-encoded. The host passes that text, still encoded, to a container (the official `node:24-slim` image pinned by digest, no network, read-only root, non-root user, no capabilities, memory and process limits, no host environment), which decodes and reads it and prints only the flags and the matched lines below. No file's text is written to disk or kept. LR's scripts, which read Dockerfiles with `grep` on the host, are changed to do this; the patterns they apply are the same.

## 3. The five new items

Each item is `yes`, `no` or `unknown`. `unknown` is "could not be counted" for that item: the repository stays in the denominator. A file that does not exist (HTTP 404, or absent from its directory's listing) is not `unknown`; one that exists but cannot be read or parsed is.

Lines are taken from the file with `\r` removed. Where a rule says **instruction**, Dockerfile lines that end in `\` are first joined with the next line, and comment lines (first non-space character `#`) are dropped.

### 3.1 Tests

- **Test script:** the stratum's manifest, in the measured Dockerfile's directory or at the root, parses as JSON and has `scripts.test` that is a non-empty string or, for `composer.json`, a non-empty array; for `package.json`, a string containing `no test specified` (what `npm init` writes) does not count.
- **Any test sign:** a test script, or the measured Dockerfile's directory or the root lists an entry named (case-insensitive) `test`, `tests`, `__tests__` or `spec` (a directory), or `phpunit.xml`, `phpunit.xml.dist` or `phpunit.dist.xml` (a file).
- `unknown` when no sign is found and a manifest that exists could not be read or parsed, or a listing could not be read.

Whether the tests run, pass or touch the network is not checked.

### 3.2 Buildable with no network (likely)

`no` when an instruction of the measured Dockerfile is a `RUN` whose text matches, case-insensitive, any of:

- `\bapt-get\s+(install|update|upgrade|dist-upgrade)\b`, `\bapt\s+(install|update|upgrade)\b`, `\bapk\s+(add|update|upgrade)\b`, `\b(yum|dnf|microdnf)\s+(install|update|upgrade|makecache)\b`, `\bzypper\s+(in|install|ref|refresh|up|update)\b`
- `\b(pecl|pear)\s+install\b`, `\binstall-php-extensions\b`
- `\b(curl|wget)\b`, `\bgit\s+(clone|fetch|pull|submodule)\b`
- `\bcomposer\s+(install|update|require|create-project|global)\b`
- `\bnpm\s+(install|i|ci|add|update|install-[a-z-]+)\b`, `\bnpx\b`, `\bpnpm\s+(install|i|add|fetch|dlx)\b`, `\byarn(\s+(install|add|dlx)\b|\s*(&&|;|\||$))`, `\bbunx?\b(\s+(install|i|add)\b)?`, `\bcorepack\s+(prepare|install)\b`
- `\bpip3?\s+install\b`, `\bgem\s+install\b`, `\bbundle\s+install\b`, `\bgo\s+(get|install|mod\s+download)\b`

or an `ADD` whose arguments contain `http://`, `https://` or `git@`. Otherwise `yes`. This is a list of commands that usually fetch from the network, applied to the text; it can be wrong both ways (a command run from a cache, or a script that downloads under another name). It says nothing about whether the application or its tests need the network once built. Ludion builds with `--network=none` (packages/cli/src/security/patch.ts, line 98).

### 3.3 Start can be checked

In the measured Dockerfile: **EXPOSE**, an instruction matching `^\s*EXPOSE\s+\S` (case-insensitive); **HEALTHCHECK**, an instruction matching `^\s*HEALTHCHECK\s+` that is not `HEALTHCHECK NONE`. Shown each, both, and either. Healthchecks in compose files or elsewhere are not read.

### 3.4 Deployed automatically on merge

- **Workflow:** a file in `.github/workflows` (section 2) that has, on a line that is not a comment, a push trigger, and has `deploy` (case-insensitive) on a line that is not a comment. A push trigger is a line matching one of: `^\s*["']?on["']?\s*:\s*["']?push["']?\s*(#.*)?$`; `^\s*["']?on["']?\s*:\s*\[[^\]]*\bpush\b`; `^\s+["']?push["']?\s*:\s*(\{\s*\}|null|~)?\s*(#.*)?$` (a `push:` key with nothing or an empty value after it, so `push: true` in an action's inputs does not count); `^\s*-\s*["']?push["']?\s*(#.*)?$`.
- **Platform file:** the root lists `vercel.json`, `netlify.toml`, `render.yaml`, `railway.json` or `railway.toml`. These platforms deploy on a push to the connected branch by default; whether the repository is connected is not visible.
- **Automatic deploy** = workflow or platform file. `unknown` when neither says yes and the workflows listing or a workflow file could not be read (more than 50 workflow files counts as read when one of the first 50 says yes, otherwise `unknown`).

Branch filters are not resolved (a push trigger on any branch counts), workflows started by `workflow_run` after a push are not followed, and `deploy` in a name or a comment-free line is taken at its word. A workflow that only publishes an image to a registry is not a deploy unless it says `deploy`.

### 3.5 End of life

LR section 3's end of life (php.net states, Node's schedule), unchanged, shown as its own count.

## 4. Decision 4: kept patched by Ludion with no person

The question: of these repositories, what share would today's Ludion keep patched for their measured base image, from the publication of a security fix to the fix being in the repository, with no person doing anything for that fix. Counted only from what Ludion does today; what it cannot do is not counted.

A chosen repository counts only when all six hold:

- **H1. Ludion patches its image.** The measured image is `php`. Basis: docs/status.md line 38, "PHP in Docker is the only runtime today"; `node` images are not patched, so every node repository fails H1.
- **H2. Ludion accepts its Dockerfile.** `phpImage` in packages/cli/src/security/php.ts (lines 31–50, at this entry's commit) accepts the measured Dockerfile's whole text: one `FROM` line, an exact `php:X.Y.Z-(cli|fpm|apache)…` reference, no frontend directive, no line continuation, no `ADD`, no `COPY --from`, no `RUN --network`/`--mount`. The function itself is run on the text, in the container of section 2.
- **H3. A fix can still come.** The measured series is not past end of life (section 3.5). Basis: `scanPhp` takes only a newer release of the same `X.Y` (php.ts, lines 87–89), and its note says "No major/minor upgrades" (line 93).
- **H4. It builds with no network** (section 3.2 `yes`). Basis: patch.ts line 98, `--network=none`.
- **H5. There is a test to run** (section 3.1, any test sign `yes`). Basis: the PHP configuration needs a non-empty test argv (packages/cli/src/security/project.ts, line 45), run in the built image (patch.ts, line 107).
- **H6. The fix reaches the repository with no person.** Basis: CLAUDE.md line 33, "The default stops at a PR."; docs/status.md line 20 lists "opening PRs on GitHub; automatic merge" as not built and says "Composer, Maven and PHP Docker updates do not go through the judge" (no gate 2, no wait); docs/status.md line 7, nothing is released; line 35, the scheduled workflow "has run only locally against a stand-in for GitHub, not on GitHub". **H6 holds for no repository today.** This is known before counting, and is written here so the result is not read as a measurement of it.

**The share** = repositories meeting H1–H6 / n, n = every chosen repository (those not countable included). Its 95% interval is the Wilson score interval with z = 1.96. A repository with an `unknown` in any of H2–H5 does not count as meeting it; how many such there are is shown.

**Shown beside it, and named as not what Ludion can do:** how many meet H1–H5 (what the files show, which would still need a person to merge, and Ludion to be released and its scheduled workflow to run on GitHub, and gate 2 and the waits for PHP images), with the same interval, how many of those also deploy automatically on merge (section 3.4), and the count at each of H1 to H5 taken in order.

## 5. What the report gives

From the raw logs, each with its denominator and its "could not be counted": LR's lag median and p90 (and exposure), Dependabot docker / Renovate configured or not, digest pinned; and the five items of section 3 (tests, buildable with no network, EXPOSE/HEALTHCHECK, automatic deploy, end of life), overall and per stratum; and section 4's share with its interval and the H1–H5 counts. A failure is written as a failure.
