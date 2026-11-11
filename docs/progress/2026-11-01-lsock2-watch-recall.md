# 2026-11-01 — LSOCK2: the bench-socket check, measured against the forms it must find and must pass

**Lane LSOCK2**, from main b803f2b. It follows up docs/mistakes/2026-11-01-docker-sock-npm-ci.md, which is not rewritten. No decision record: nothing in the goal, scope, gates, waits or rules changes, and Ludion's behaviour does not change, so docs/status.md does not change either.

## Why

The mistake record's Check says tools/records/test/bench-socket.test.ts "follows every container started with the socket" and "fails on an `npm ci`, `npm install` or similar without `--ignore-scripts`". The review of PR #248 tried other ways of writing the same mistake. The check at merge found 3 of its 10 command forms (P1-P17) and 3 of its 7 ways of giving the socket (Q0-Q4). The Check sentence claimed more than the check did.

The first review of this PR (on head a4810e6) found three places where this record and the code's comments still claimed more than the check:

- `npm link`, `npm ln` and `npm audit fix` were missing from "all the npm commands that install".
- No test guarded the re-reading of a script reached again (N8).
- Many forms the check cannot follow were in neither the known-miss table nor this record.

The second review (on head 24002b7) found that the way the npm commands were then chosen, by the `ignore-scripts` option, left out `npm uninstall` and its aliases. Five mutations of the check were also not caught by any probe. That version fixed those, and the non-blocking points below.

The third review (R249c, on head f6ff08b) found that "every alias and typo npm accepts" was not true: npm also takes unique abbreviations and camelCase forms, and `npm edit` reaches rebuild. This version takes that claim out and adds those forms to the known misses. The check's rules do not change; they are as at d637f72. This check does not try to find every form: stopping every form is left to a later allow-list (LGUARD2), not built here. The third review's non-blocking points are not handled in this PR.

## What changed

Only tools/records/test/bench-socket.test.ts. No file under docs/bench/ needed a change: the real tree passes the stronger check as it is.

- **The command.**
  - **Which npm commands.** The check covers these of npm's commands that change node_modules, and so can run install scripts. They were chosen from what each command does in npm 11.19.1 (the npm in the node:24 image), by reading lib/commands/:
    - the commands that call Arborist's `reify`, `dedupe`, `prune` or `rebuild`: ci, install, link, uninstall, update, dedupe, prune and rebuild, with install-test and install-ci-test, which run through install and ci;
    - and `npm audit fix`, which calls `arb.audit({ fix })`.

    The first choice in this PR, "every command whose options include `ignore-scripts`", left out uninstall: its options do not list `ignore-scripts`, but it reifies. Run in Docker with no network, on two packages made for the test, `npm uninstall b`, `rm`, `r`, `un`, `remove` and `unlink` each ran the other package's postinstall. `npm uninstall b --ignore-scripts` did not run it.

    Left out on purpose:
    - the commands that run only the project's own scripts: run, test, start, stop, restart, pack, publish and version. They are the same class as the `npm run build` the mistake record names.
    - find-dupes, which is a dry run.
    - `npm audit` without fix, which is a report.

    Not covered, though it can run install scripts: `npm edit`, which reaches rebuild through `npm.exec('rebuild', [dir])` in lib/commands/edit.js (R249c's reading). It is known misses 28 and 29.
  - **Aliases.** The check reads these words for those commands, and no others: `ci`, `clean-install`, `ic`, `install-clean`, `isntall-clean`, `install`, `i`, `in`, `ins`, `inst`, `insta`, `instal`, `isnt`, `isnta`, `isntal`, `isntall`, `add`, `install-test`, `it`, `install-ci-test`, `cit`, `clean-install-test`, `sit`, `rebuild`, `rb`, `update`, `u`, `up`, `upgrade`, `udpate`, `dedupe`, `ddp`, `link`, `ln`, `prune`, `uninstall`, `unlink`, `remove`, `rm`, `r`, `un`. Words between `audit` and `fix` are allowed (`npm audit --json fix`). npm accepts more words than these (known misses 21 to 27). What is measured is the fixed tables only: must find 115/115, must pass 33/33, known misses 29/29 not found.
  - **The ignore-scripts flags.**
    - `--ignore-scripts false`, `=false`, `=0` and `--no-ignore-scripts` leave scripts on.
    - The last flag wins over an earlier one and over `npm_config_ignore_scripts`.
    - npm reads no flags after `--`, so `npm ci -- --ignore-scripts` leaves scripts on. In the same Docker test it ran the postinstall.
  - **How npm can be written.**
    - Quotes are ignored (`npm "ci"`).
    - npm can be given by its path (`/usr/local/bin/npm`), by a variable that holds it (`NPM=npm; $NPM ci`, `NPM=/usr/bin/npm`, `NPM=$(command -v npm)`), or by a variable's default (`${NPM:-npm}`). A path counts only in a bin/ folder, so `dir=/e/npm` is not npm.
    - `NPM=$(command -v npm)` was named in the code's comment from the first version but was not read until this version, because a value stopped at its first space.
    - A newline ends a command, as `;` does.
  - **Package runners.** `npm create` and `npm init <initializer>` count, as `npm exec` already did.
- **JavaScript.**
  - **What is read.** In .mjs, .cjs, .js, .ts, .mts and .cts files, strings are read as commands (`execSync("npm ci")`, `spawnSync("sh", ["-c", "npx tsx x.ts"])`). So is a program with its argument list (`execFileSync("npm", ["clean-install"])`). `\n` in a string is a newline, so `sh.stdin.write("echo start\nnpm ci\n")` is two commands.
  - **Only printed strings.** A string counts as only printed when it is the first argument of `console.*`, `process.stdout.write`, `process.stderr.write` or an `Error`. So `sh.stdin.write("npm ci\n")` and `runAndlog("npm ci")` are read as commands. A template string's `${…}` parts are always read, because they run even when the template is printed (`` console.log(`out: ${execSync("npm ci")}`) ``).
  - **Docker clients.** A script whose strings run the docker CLI (`execSync("docker ps")`) counts as a docker client.
- **The socket.**
  - **What gives it.** A line gives the socket when it names `docker.sock` (as before), the Windows pipe `docker_engine`, or `DOCKER_HOST`. It also does when it bind-mounts `/`, `/var`, `/run` or `/var/run` (`-v`, `--volume`, `--mount source=`/`src=`).
  - **Variables.** A variable makes every line that uses it a socket line when a file sets it to such text, or to one of those folders. The assignment can take these forms:
    - `SOCK=/var/run/docker.sock`
    - `SOCK_DIR=$(dirname /var/run/docker.sock)`
    - `SOCK_DIR=/var/run`
    - a bash array, which may hold `$(…)`: `args=(-v "$(pwd)/x:/x" -v …docker.sock…)`
    - `args+=(…)`
    - `args[1]=…`
  - **Variables passed on.** Such a variable is passed to the scripts a socket line runs, with that line's arguments. So `DOCKER_ARGS="-v /var/run/docker.sock:…" sh …/run.sh full` follows run.sh's `docker run ${DOCKER_ARGS:-} … sh "/scripts/$script.sh"` into full.sh. An exported variable is passed to every script the file runs.
- **Scripts followed.** .sh, .bash, .mjs, .cjs, .js, .ts, .mts, .cts and .ps1. .bash, .ts, .mts and .cts are new; Node 24 runs `node x.ts` directly. .bash is read as shell (its comments are skipped), and .mts and .cts as JavaScript.
- **Reading a script again.** A script reached again with other mounts, variables or arguments is read again (R248's N8). Three must-find probes now fail if any part of that is undone: the arguments, the variables or the mounts.
- **Options before run or exec.** An option before `run` or `exec` (`docker --a run`, `npm --yes exec`) is matched as `-[\w-]+`, so it matches only one way. Before, each option matched two ways, and the time doubled with every added option.

## The tables and the counts

The test has three tables of small made-up trees:

- **Must find:** 115 forms. A form counts as found when a finding names the expected file and line.
- **Must pass:** 33 forms. Nothing may be found.
- **Known miss:** 29 forms the check should find but does not. Each is asserted to be not found, so that a later fix shows up as a change in the test.

The 115 must-find forms are R248's P and Q probes, its R2 and R3 mutations, the npm commands and aliases above, and the forms the first two reviews of this PR named. They are grouped in six parts:

- 71 command forms:
  - 6 flag forms and `--` before `--ignore-scripts`
  - 41 aliases
  - `npm link ../pkg`
  - 4 forms of `npm audit fix`
  - P6, 4 forms of P7 and 3 forms of P8
  - npm by its path
  - 9 package runners
- 10 JavaScript forms, P16 and P17 among them.
- 2 commands started on the socket line itself (R2, R3).
- 6 kinds of script the socket container runs: .ts, .mts, .cts and .bash, and an argument list in .mts and in .cts.
- 23 ways of giving the socket: Q0 in 4 forms, Q1 in 5, Q2 in 2, Q3 in 8, Q4, and Q6 in 3. The 8 forms of Q3 are the path, the mount, a bash array, a bash array holding `$(pwd)`, `+=`, an array element, the socket's folder, and the folder from `$(dirname …)`.
- 3 for reading a script again (N8): with other arguments, other variables or other mounts.

Each time, the tables were written first and run against the check before it was changed:

| Tables committed in | Run against the check at | Check changed in |
|---|---|---|
| de7962e | main b803f2b | b3c7e39 |
| ac4825f | a4810e6 | f099148 |
| 20c0c8f | 24002b7 | d637f72 |

The third review changed no rule of the check, so it has no row here: its forms went into the known-miss table only.

Each earlier row below was counted again with the tables as they stood at f6ff08b (20 known misses): that check, with those tables appended. The 9 known misses added after the third review were not run against the earlier checks.

| Check | Must find | Must pass | Known misses (not found) |
|---|---|---|---|
| main b803f2b | **25 / 115** (commands 19/71, JavaScript 0/10, socket-line commands 2/2, script kinds 0/6, ways of giving the socket 4/23, N8 0/3) | 33 / 33 | 20 / 20 |
| a4810e6, the head the first review read | **82 / 115** (54/71, 6/10, 2/2, 0/6, 17/23, 3/3) | 33 / 33 | 20 / 20 |
| 24002b7, the head the second review read | **101 / 115** (63/71, 8/10, 2/2, 6/6, 19/23, 3/3) | 33 / 33 | 20 / 20 |
| d637f72 and f6ff08b | **115 / 115** | 33 / 33 | 20 / 20 |
| this branch (the same rules, the table with 9 more known misses) | **115 / 115** | 33 / 33 | 29 / 29 |

The review of PR #248's own probes, counted the same way. Its ids are kept in the test's table: P3 is `npm clean-install`, P4 `npm install-ci-test`, P5 `npm i`.

| | main b803f2b | this branch |
|---|---|---|
| Commands, P1-P8, P16, P17 | 3 / 10 (P1, P5, P6) | 10 / 10 |
| Ways of giving the socket: Q0, `--mount`, `//var/run/docker.sock`, Q1-Q4 | 3 / 7 | 7 / 7 |
| Q6, DOCKER_ARGS with the socket in a README code block | 0 / 1 | 1 / 1 |
| Q5, the socket given only on a command line outside the repository | 0 / 1 | 0 / 1 (known miss) |

The 29 known misses, each a tree in the test's known-miss table:

1. Q5: a launcher that takes `DOCKER_ARGS`, when the socket was passed only on a command line typed outside the repository. No file says the socket is given.
2. A socket path set in a file that another script sources (`. ./env.sh`). Variables are read one file at a time.
3. A command name built at run time (`c=n; ${c}pm ci`).
4. A heredoc given to the socket container (`docker run -i … sh <<'EOF'`, then `npm ci`). A heredoc's lines are not read as the container's commands.
5. `docker exec c npm ci` in a container started earlier with the socket (`docker run -d --name c …`). Containers are not tracked by name across lines.
6. `docker exec c sh /scripts/e2e.sh`, for the same reason.
7. `--volumes-from` a container that has the socket, for the same reason.
8. A compose file whose service mounts the socket under `volumes:` and runs `command: sh -c "npm ci"`. A service's other keys are not tied to its volumes.
9. A script with no extension (`sh /scripts/e2e2`).
10. A Python script (`python3 /scripts/e2e.py`; node:24 has python3 and perl). As with 9, only files ending in .sh, .bash, .mjs, .cjs, .js, .ts, .mts, .cts or .ps1 are followed.
11. `node /usr/local/lib/node_modules/npm/bin/npm-cli.js ci`. npm's own script is not read as npm.
12. `node "$(command -v npm)" ci`. A command substitution is a separate segment.
13. The whole command in a variable on the socket line (`INSTALL="npm ci"`, then `sh -c "cd /w && $INSTALL"`).
14. A JavaScript argument list over several lines (`spawnSync("npm", [` with `"ci",` on the next line). Lines are read one at a time.
15. A JavaScript argument list joined into a string (`["npm", "ci"].join(" ")`).
16. npm in a JavaScript variable (`const npm = "npm"; spawnSync(npm, ["ci"])`).
17. npm in a template string's variable (`` execSync(`${npm} ci`) ``).
18. `--privileged`. It gives the host's devices, not the socket, and is not looked at.
19. The rootless socket's folder (`-v /run/user/1000:/run/user/1000`). Only `/`, `/var`, `/run` and `/var/run` count as the socket's folder.
20. `DOCKER_HOST` inside an `--env-file`. Env files are not read.
21. A unique abbreviation of uninstall (`npm uninst b`). 21 to 27 are read only as the words in the install list.
22. A unique abbreviation of rebuild (`npm rebuil`).
23. A unique abbreviation of dedupe (`npm dedup`).
24. A unique abbreviation of update (`npm upd`).
25. A unique abbreviation of audit, before fix (`npm aud fix`).
26. A camelCase form of clean-install (`npm cleanInstall`).
27. A camelCase form of install-test (`npm installTest`).
28. `EDITOR=true npm edit a`. edit is not in the install list.
29. `EDITOR=true npm ed a`, for the same reason.

21 to 29 are R249c's result, on node:24 and npm 11.19.1 with no network. This lane did not run them on npm again; it only asserts that the check does not find them. R249c's findings:

- **How npm reads the word.** `deref` in lib/utils/cmd-list.js turns camelCase into dashed words and accepts any abbreviation that is unique, before it looks up the aliases.
- **What ran.** The forms above, except `npm aud fix`, each ran a dependency's postinstall. `npm installTest` also exited 1, as the project had no test. `npm rebuil` ran with node_modules in place. `npm edit` and `npm ed` did not run it with `--ignore-scripts`.
- **What did not run.** `npm aud fix` was not run, because audit needs a registry. `deref` gave audit for `aud`, and the check does not find the form.

The 9 trees are examples of these kinds. R249c's `deref` call gave these other words, which are not in the install list either and are not trees in the table:

- ci: `install-cl`, `install-cle`, `install-clea`, `isntall-`, `isntall-c`, `isntall-cl`, `isntall-cle`, `isntall-clea`
- install-test: `install-t`, `install-te`, `install-tes`
- install-ci-test: `si`, `install-ci`, `install-ci-`, `install-ci-t`, `install-ci-te`, `install-ci-tes`, `clean-install-`, `clean-install-t`, `clean-install-te`, `clean-install-tes`
- rebuild: `reb`, `rebu`, `rebui`
- update: `ud`, `udp`, `udpa`, `udpat`, `upda`, `updat`, `upg`, `upgr`, `upgra`, `upgrad`
- dedupe: `dd`, `ded`, `dedu`
- link: `lin`
- prune: `pru`, `prun`
- uninstall: `rem`, `remo`, `remov`, `uni`, `unin`, `unins`, `uninsta`, `uninstal`, `unl`, `unli`, `unlin`
- audit: `audi`
- camelCase: `installClean`, `isntallClean`, `installCiTest`, `cleanInstallTest`

The first review tried 41 forms of its own. It named 7 of them in blocking point 3 and more in point 4, and every named form is in a table here: as must-find where the check now finds it (a bash array, a socket folder in a variable, .ts, .mts and .bash scripts), and as a known miss otherwise. The forms it tried but did not name are not measured here. The second review's named forms are all in a table too: npm uninstall and its 5 aliases, 4 bash forms, the printed template, the later line of a shell's input, a Python script, and `--` before `--ignore-scripts`. The third review's blocking forms are known misses 21 to 29. The forms it named only in its non-blocking points are not measured here.

Mutations of the test's code, each applied to the copy in the volume, run against bench-socket.test.ts, and undone. At f099148, 10 of 10 were caught. At d637f72, 15 of 15 were caught, the 5 the second review found uncaught among them:

| Mutation (at d637f72) | Probes that failed |
|---|---|
| the seen key is the path only (R248's N8 undone) | 3 (N8 ×3) |
| the seen key without the arguments | 1 |
| the seen key without the variables | 1 |
| the seen key without the mounts | 1 |
| uninstall and its aliases out of the install list | 6 |
| no word allowed between `audit` and `fix` | 1 |
| isShell without .bash | 1 (must pass: a comment in a .bash script) |
| isJs without .mts and .cts | 2 |
| flags after `--` read | 1 |
| a newline does not end a command | 1 |
| a template's `${…}` parts not read | 1 |
| a bash array cannot hold `$(…)` | 1 |
| no `+=` assignment | 1 |
| no `NAME[i]=` assignment | 1 |
| no `$(…)` value | 2 (`$(command -v npm)`, `$(dirname …)`) |

At f099148: the seen key the path only, `link` and `ln` out, `prune` out, `u` out, `audit … fix` not matched, a socket folder in a variable not counted, a bash array not read, the earlier "only printed" rule, `\n` read as `n`, and .bash/.ts/.mts/.cts not followed.

Mutations of the real tree, each applied to the copy in the volume, run against the check, and undone. All were caught, and the control was not:

| Mutation | Finding |
|---|---|
| M1 LV3's e2e.sh: `npm clean-install` | docs/bench/2026-10-30-lv3-osv-publisher/scripts/e2e.sh:9 |
| M2 LNODE's github.mjs: `execSync("npm ci --no-audit")` | docs/bench/2026-10-31-lnode/scripts/github.mjs:34 |
| M3 LB's e2e.sh: `--ignore-scripts false` | docs/bench/2026-10-30-lb-design/scripts/e2e.sh:12 |
| C0 control: LNODE's e2e.sh with a scripted `npm ci`, without `$(docker --version)`, without the README's socket line, and with run.sh's e2e line given no socket | none, as expected |
| M4 as C0, run.sh's e2e line given `-e DOCKER_HOST=tcp://…` | docs/bench/2026-10-31-lnode/scripts/e2e.sh:12 |
| M5 as C0, with `-v /var/run:/var/run` | docs/bench/2026-10-31-lnode/scripts/e2e.sh:12 |
| M6 as C0, with `-v /:/host` | docs/bench/2026-10-31-lnode/scripts/e2e.sh:12 |
| M7 LV3's README: a code block running `DOCKER_ARGS="-v /var/run/docker.sock:…" sh …/run.sh full` | docs/bench/2026-10-30-lv3-osv-publisher/scripts/full.sh:8 |
| M8 LV3's e2e.sh: `npm audit fix` | docs/bench/2026-10-30-lv3-osv-publisher/scripts/e2e.sh:9 |
| M9 LV3's e2e.sh: `npm uninstall lodash` | docs/bench/2026-10-30-lv3-osv-publisher/scripts/e2e.sh:9 |

M1-M7 ran at b3c7e39, M8 at f099148 and M9 at d637f72.

## Other checks (all in Docker)

The image was node:24, pinned by digest (sha256:e7add2a4…). The tree was copied into the volume ludion-lsock2-w, with `--memory 4g` and no socket. `npm ci --ignore-scripts` ran once with the network; everything else ran with `--network none`.

At d637f72:

- tools/records/test/: 2 files, 187 tests passed.
- `npm run typecheck`: exit 0. `npm run build`: exit 0.
- `npm test -- --maxWorkers=2`: 43 files passed, 1667 tests passed, 25 skipped.
- The new assignment pattern on long inputs that do not match grows quadratically, with no exponential backtracking. ` a=($(` repeated 1000, 2000, 4000 and 8000 times took 2, 7, 29 and 123 ms. ` a[` took 1, 5, 18 and 75 ms.

No e2e was run, and no container was given the socket.

After the third review only the test's comments and known-miss table, and this record, changed. For that version, only tools/records/test/ was run in local Docker: node:24 by tag (node 24.22.2, npm 11.19.1; its digest was not read), a copy of the tree in a volume, `--memory 2g`, no socket, and `--network none` after `npm ci --ignore-scripts`. 2 files, 196 tests passed: must find 115/115, must pass 33/33, known misses 29/29 not found. That run was before this paragraph was written. Typecheck, build and the full suite for that version are the PR's CI.

## The record's "35 times" and the audit's 42

The mistake record says "Between 2026-10-29 and 2026-10-31 the e2e ran this way 35 times, all but one with the network on". It does not say how it counted. The review of PR #248 could not confirm 35 from the repository, which holds 23 committed e2e logs across the six folders.

The first-principles audit of 2026-11-01 counted differently. It read the agents' session records on the machine used (grep and awk only) and counted the calls that started a container given the socket: `docker run` lines containing `docker.sock`, and the `run.sh e2e` form. It found 42 runs of the six folders' e2e.sh, from 2026-10-29 11:02Z to 2026-10-31 13:54Z: LA 17, LB and LB2a 18, LV 2, LV3 2, LNODE 2, LIMGV 1. None of the 42 had `--network none`. The audit rated the count medium-confidence, because other ways of writing the command may have been missed.

The audit also found 5 more socket runs whose scripts are not in the repository. They ran from a job's temporary folder: 4 for LC and 1 for LV2. Each had no `npm ci`, or had it with `--ignore-scripts`. A check that reads the repository can never see such runs.

Why 35 differs from 42 is unknown. This lane did not count the session records again. It also did not check whether each of the 42 runs' e2e.sh lacked `--ignore-scripts` at that time.

## Where the Check sentence still claims more than the check

The record is not rewritten (CLAUDE.md, How we work). After this change, "follows every container started with the socket" and "an `npm ci`, `npm install` or similar" are still stronger than the check in these cases:

- **Outside the repository.** Containers started by scripts outside the repository, such as the 5 runs above, are not seen.
- **The 29 known misses above.** Each is a tree in the test that the check does not find:
  - 4 to 10 are containers started with the socket, or scripts they run, that the check cannot follow.
  - 11 to 17 and 21 to 29 are installs written in a form the check does not read.
  - 1 to 3 and 18 to 20 are ways of giving the socket, or the host, that the check does not see.
- **A writable mount of the worktree.** It is not looked at. A container started that way can also reach the host. It is outside the forms this lane was given.
- **The project's own scripts.** pack, publish, version and the run family (`npm run build` among them, the mistake record's "Not fixed here") are not checked.

## Not changed, and why

- **False alarms.** The check errs the safe way in some forms, and these are not counted here. Each finds a command where none runs, and none is in the real tree, which passes. They are left as they are, because narrowing them would risk missing a real install. The forms:
  - `npm ci` as the text of `grep -q "npm ci" log`, in the body of `cat <<'EOF'`, and in a JavaScript `const msg = "npm ci failed"`.
  - An `npm ci` that follows `export npm_config_ignore_scripts=true` on an earlier line.
  - Since the aliases were added, an alias as a later word of any npm command: `npm run link`, `npm run prune`, `npm test -- -t u`, `npm view lodash ln`, and `npm audit --json > fix.json`.
  - A variable set to `/` used for another folder (`prefix=/` then `-v "${prefix}opt/data:/data"`), which makes its line a socket line.
- **Symbolic links.** benchFiles follows symbolic links under docs/bench/, as on main. git holds no symbolic link under docs/bench/ (0 entries of mode 120000). A new one would have to be committed and so would show in a PR's diff. Changing how the tree is read is not part of measuring the check's recall.

The check is measured only against the tables above. A form in none of the tables has not been measured.
