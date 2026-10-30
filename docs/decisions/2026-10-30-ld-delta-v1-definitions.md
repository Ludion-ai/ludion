# 2026-10-30 (LD) — Delta v1: can the diff from the previous version tell a malicious version from a genuine fix? Definitions fixed before any tarball is fetched

The owner asked for an algorithm instead of a fixed wait (2026-10-30 08:41–08:43 JST, to the Claude chat: 「固定時間じゃなくてアルゴリズムを作れないのか」「全部第一原理で見ろ」「絶対に固定概念に縛られてはいけない」). Waiting hands the checking to someone else in the world. Malicious code must be in the diff from the previous version, and a security fix's diff is usually small. So lane LD measures, on real data, whether checking the diff itself works. This is the body of what docs/status.md lists as not built: gate 2's inspection for obfuscated code and new network or process calls.

**This is an experiment. It changes no product code** (packages/cli, judge.ts, the gates, the wait table). Nothing here changes a gate's criteria or the wait table.

This entry is committed and pushed before any tarball, file list or file of any version is fetched for this lane. A later change to it is a new entry, with the reason, and the results say which definitions they used. The only data read before this entry: the row counts and field names of `docs/bench/2026-10-28-backtest-v5/malicious-v5.json` and `docs/bench/2026-10-28-backtest-v4/fixes-v4.json`, and v5's README (which records that jsDelivr's CDN answered 404 for 988 removed versions' files).

## 1. The data

- **Malicious versions:** the 1,148 `rows` of `docs/bench/2026-10-28-backtest-v5/malicious-v5.json`, each V compared with its row's `previous` (none of those previous versions is itself a row).
- **Genuine fixes:** the 200 `rows` of `docs/bench/2026-10-28-backtest-v4/fixes-v4.json` (`from` → `to`). v5 carried over v4's genuine sample unchanged (v5 README, "Genuine fixes"), so these are v5's genuine fixes. v4 drew them from the 2025 GHSA npm fix events in the order of a SHA-256 key (fixes-v4.ts), not by choice. All 200 are used; none is left out after the fact.

## 2. Getting a version's files

Each version's files are obtained from these official sources, in this order, the first complete one used. A source that fails moves to the next.

1. **The registry tarball** (`https://registry.npmjs.org/<name>/-/<base>-<version>.tgz`). Accepted when it matches a known hash: the sha512 integrity, else the sha1 shasum, from the registry's packument, or for a version the registry no longer lists, from ecosyste.ms's copy of its version document (as v5 used). With no known hash at all, it is accepted and counted apart as "registry, hash unknown".
2. **jsDelivr:** the flat file list (`data.jsdelivr.com`) and every listed file from `cdn.jsdelivr.net`, each file's SHA-256 checked against the list. Every file must be obtained, or jsDelivr does not hold the version.
3. **Software Heritage:** the version's directory as v5 locates it (`swhLocate`: the `releases/<version>` branch in the first two snapshots with a visit at or after publication), every file fetched from its content endpoint and checked against the directory's SHA-256. Software Heritage allows 120 anonymous requests an hour, too few for every version. So its lookups go in the order of SHA-256(`name@version`), and stop **6 hours** after the first one. A version not looked up by then is counted as **not obtained, not looked up in time**, separately from "not held".

A version not obtained from any source is **not obtained** (取れない), with the reason from each source. It is never guessed or filled in.

**Safety.** Everything runs in a Docker container with no credentials (no host home, .npmrc or gh/git authentication mounted), a read-only root, a non-root user and no forwarded environment. Tarballs and files are held in memory and read as bytes. Nothing is extracted to a disk, installed, required or run. Only the fetchers' JSON answers (lists, metadata, never package files) are cached, in a named Docker volume that is deleted at the end. The repository receives only package names, versions, outcomes, numbers and sentences of reason: no file content of any version.

## 3. What the analyzer reads

`tools/backtest/src/delta.ts`: a pure function of the two versions' files (path → bytes, the tarball's top folder stripped).

- **Code files:** paths ending `.js`, `.cjs`, `.mjs`, `.jsx`, `.ts`, `.cts`, `.mts`, `.tsx` (not `.d.ts`, `.d.cts`, `.d.mts`); every file named by `package.json`'s `bin`; any file without an extension whose first line starts with `#!` and names `node`.
- **A changed code file:** a code file of the new version whose bytes equal no file of the previous version (so a file moved unchanged is not changed). It is compared with the previous version's file at the same path, or with nothing if there is none.
- **Text:** bytes read as UTF-8. Counts are of regular-expression matches in the whole text, comments and strings included.

## 4. New capabilities (新しい能力)

Each capability is counted per changed code file. It is **new** when its count in the new file is greater than in the previous file at the same path (0 when there is none), except where a rule says otherwise.

1. **Modules:** a `require("m")`, `import … from "m"`, `import "m"`, `import("m")` or `export … from "m"` of `m`, with or without `node:`, for each of: `child_process`, `net`, `http` / `https` / `http2` (counted together as http(s)), `dns`, `tls`, `dgram`, `worker_threads`, `vm`. Each module is its own capability.
2. **Network APIs:** `fetch(`; `XMLHttpRequest`; `WebSocket`. Each is its own capability.
3. **Code from strings:** `eval(`; `new Function(`. Each is its own capability.
4. **Install scripts** (package.json, not per file): `preinstall`, `install` or `postinstall` added, or its command changed; or `binding.gyp` added at the root while neither `install` nor `preinstall` is declared and `gypfile` is not `false` (npm then runs `node-gyp rebuild`).
5. **New dependencies** (package.json): a name in the new version's `dependencies`, `optionalDependencies` or `peerDependencies` that is in none of the previous version's three. A changed range of an existing dependency is not new. `devDependencies` are not installed by consumers and are not read.
6. **New binaries:** a file added, or changed, that ends `.node`, `.exe`, `.dll`, `.so`, `.dylib` or `.wasm`, or starts with an executable's magic bytes (ELF `7F 45 4C 46`; PE `MZ` with `PE\0\0` at the offset in bytes 0x3C–0x3F; Mach-O `FE ED FA CE`, `FE ED FA CF`, `CE FA ED FE`, `CF FA ED FE`, `CA FE BA BE`; WebAssembly `00 61 73 6D`). Any file, not only code files.
7. **Obfuscation markers**, per changed code file, each its own capability:
   - **long hex:** a run of at least 200 hex digits, or of at least 50 consecutive `\xHH` or `\uHHHH` escapes;
   - **long base64:** a run of at least 200 characters of `A–Z a–z 0–9 + /` that is not all hex digits;
   - **high-entropy line:** a line of at least 200 characters whose Shannon entropy over its characters is at least 5.5 bits per character;
   - **very long line:** a line of at least 5,000 characters;
   - **obfuscator names:** identifiers `_0x` followed by at least 4 hex digits.

**A clean diff** (きれいな差分): not one of these capabilities is new. **Flagged** (新しい能力あり): at least one is new.

**Undecidable:** either version has no root `package.json`, its `package.json` is not a JSON object, or its tarball cannot be read. Undecidable is neither clean nor flagged and is counted apart.

**Shown, never part of "clean":** these are recorded per version, to explain the results, and do not change any count above: new shell or script files (`.sh`, `.bat`, `.cmd`, `.ps1`, `.py`, `.vbs`); per changed code file, increases in `process.env`, `os.homedir`/`homedir()`, `Buffer.from(…, "base64")` and `atob(`; and the package-wide reading of rules 1–3 and 7 (new when the total count over all code files rises).

## 5. The size of a diff

Recorded for every compared pair: files added, removed and changed (any file, by bytes); changed code files; lines added and removed over text files (a file is text when its first 8,000 bytes have no NUL byte). Lines are compared as multisets, ignoring order: a line counts as added once for each copy in the new file beyond the previous file's copies. Shown as median and maximum, for the malicious and the genuine pairs separately.

## 6. What is counted

- **Malicious versions:** obtained (both V and its previous), and of those, flagged, clean (**a miss**) or undecidable; not obtained, by reason (V not obtained, previous not obtained, or both; not held, or not looked up in time).
- **Genuine fixes:** the same. A flagged genuine fix is **a false alarm**.
- **Per capability:** the versions it fires on and those it alone fires on, for both sets.
- **Every missed malicious version** gets a sentence saying why it passed, written from the analyzer's facts (which files changed, which capabilities the changed files already had), never by reading the code.
- No result is a pass. A version that was not obtained, or is undecidable, is never counted as caught or as clean.

There is no pass mark: this lane measures; whether a rule built on it is good enough is the owner's decision. If a definition here turns out wrong, it is changed by a new entry with the reason, and both results are shown.

## 7. Outputs

`docs/bench/2026-10-30-delta-v1/`: `delta-v1.json` (per version: source, status, flagged capabilities, sizes; no file content and no file paths of malicious versions), the run log, the scripts, and a README with the counts, the size distributions, every miss with its reason, and when each step was committed. A progress entry in `docs/progress/`.
