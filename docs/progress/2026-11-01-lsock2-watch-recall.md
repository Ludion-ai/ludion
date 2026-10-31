# 2026-11-01 — LSOCK2: the bench-socket check, measured against the forms it must find and must pass

**Lane LSOCK2**, from main b803f2b. It follows up docs/mistakes/2026-11-01-docker-sock-npm-ci.md, which is not rewritten. No decision record: nothing in the goal, scope, gates, waits or rules changes, and Ludion's behaviour does not change, so docs/status.md does not change either.

## Why

The mistake record's Check says tools/records/test/bench-socket.test.ts "follows every container started with the socket" and "fails on an `npm ci`, `npm install` or similar without `--ignore-scripts`". The review of PR #248 tried other ways of writing the same mistake. The check at merge found 3 of its 10 command forms (P1-P17) and 3 of its 7 ways of giving the socket (Q0-Q4). The Check sentence claimed more than the check did.

The first review of this PR (on head a4810e6) found three places where this record and the code's comments still claimed more than the check:

- `npm link`, `npm ln` and `npm audit fix` were missing from "all the npm commands that install".
- No test guarded the re-reading of a script reached again (N8).
- Many forms the check cannot follow were in neither the known-miss table nor this record.

This version fixes the first two and lists the third.

## What changed

Only tools/records/test/bench-socket.test.ts. No file under docs/bench/ needed a change: the real tree passes the stronger check as it is.

- **The command.**
  - **Which npm commands.** The check covers the npm commands that install packages, and so run their install scripts. To fix that set, npm 11.19.1 (the npm in the node:24 image) was read: every command whose options include `ignore-scripts`. It leaves out the commands that run only the project's own scripts (run, test, start, stop, restart, pack, publish, version), which are the same class as the `npm run build` the mistake record names, and it leaves out find-dupes, which is a dry run. That leaves ci, install, install-test, install-ci-test, rebuild, update, dedupe, link, prune and `audit fix`.
  - **Aliases.** Every alias and typo npm 11.19.1 accepts for these: `ci`, `clean-install`, `ic`, `install-clean`, `isntall-clean`, `install`, `i`, `in`, `ins`, `inst`, `insta`, `instal`, `isnt`, `isnta`, `isntal`, `isntall`, `add`, `install-test`, `it`, `install-ci-test`, `cit`, `clean-install-test`, `sit`, `rebuild`, `rb`, `update`, `u`, `up`, `upgrade`, `udpate`, `dedupe`, `ddp`, `link`, `ln`, `prune`. `npm audit` alone is a report and is not matched; only `npm audit … fix` is.
  - **The ignore-scripts flags.** `--ignore-scripts false`, `=false`, `=0` and `--no-ignore-scripts` leave scripts on. The last flag wins over an earlier one and over `npm_config_ignore_scripts`.
  - **How npm can be written.** Quotes are ignored (`npm "ci"`). npm can be given by its path (`/usr/local/bin/npm`), by a variable that holds it (`NPM=npm; $NPM ci`, `NPM=/usr/bin/npm`), or by a variable's default (`${NPM:-npm}`). A path counts only in a bin/ folder, so `dir=/e/npm` is not npm.
  - **Package runners.** `npm create` and `npm init <initializer>` count, as `npm exec` already did.
- **JavaScript.**
  - **What is read.** In .mjs, .cjs, .js, .ts, .mts and .cts files, every string is read as a command (`execSync("npm ci")`, `spawnSync("sh", ["-c", "npx tsx x.ts"])`), and so is a program with its argument list (`execFileSync("npm", ["clean-install"])`). `\n` in a string is a newline.
  - **Only printed strings.** A string counts as only printed when it is the first argument of `console.*`, `process.stdout.write`, `process.stderr.write` or an `Error`. So `sh.stdin.write("npm ci\n")` and `runAndlog("npm ci")` are read as commands.
  - **Docker clients.** A script whose strings run the docker CLI (`execSync("docker ps")`) counts as a docker client.
- **The socket.**
  - **What gives it.** A line gives the socket when it names `docker.sock` (as before), the Windows pipe `docker_engine`, or `DOCKER_HOST`. It also does when it bind-mounts `/`, `/var`, `/run` or `/var/run` (`-v`, `--volume`, `--mount source=`/`src=`).
  - **Variables.** A variable makes every line that uses it a socket line when a file sets it to such text (`SOCK=/var/run/docker.sock` then `-v "$SOCK:$SOCK"`), to a bash array of such text (`args=(-v …docker.sock…)` then `"${args[@]}"`), or to one of those folders (`SOCK_DIR=/var/run`).
  - **Variables passed on.** Such a variable is passed to the scripts a socket line runs, with that line's arguments. So `DOCKER_ARGS="-v /var/run/docker.sock:…" sh …/run.sh full` follows run.sh's `docker run ${DOCKER_ARGS:-} … sh "/scripts/$script.sh"` into full.sh. An exported variable is passed to every script the file runs.
- **Scripts followed.** .sh, .bash, .mjs, .cjs, .js, .ts, .mts, .cts and .ps1 (.bash, .ts, .mts and .cts are new; Node 24 runs `node x.ts` directly). A script reached again with other mounts, variables or arguments is read again (R248's N8). A must-find probe now fails if that is undone.
- **Options before run or exec.** An option before `run` or `exec` (`docker --a run`, `npm --yes exec`) is matched as `-[\w-]+`, so it matches only one way. Before, each option matched two ways, and the time doubled with every added option.

## The tables and the counts

The test has three tables of small made-up trees:

- **Must find:** 96 forms. A form counts as found when a finding names the expected file and line.
- **Must pass:** 32 forms. Nothing may be found.
- **Known miss:** 19 forms the check should find but does not. Each is asserted to be not found, so that a later fix shows up as a change in the test.

The 96 must-find forms are R248's P and Q probes, its R2 and R3 mutations, the npm commands and aliases above, and the forms the first review of this PR named. They are grouped in six parts:

- 62 command forms: 6 flag forms, 35 aliases, `npm link ../pkg`, 3 forms of `npm audit fix`, P6, 3 forms of P7, 3 forms of P8, npm by its path and 9 package runners.
- 8 JavaScript forms, P16 and P17 among them.
- 2 commands started on the socket line itself (R2, R3).
- 4 kinds of script the socket container runs (.ts, .mts, .cts, .bash).
- 19 ways of giving the socket: Q0 in 4 forms, Q1 in 5, Q2 in 2, Q3 in 4 (the path, the mount, a bash array, the socket's folder), Q4, and Q6 in 3.
- 1 launcher reached twice with other arguments (N8).

The tables were written first and run against the check before it was changed: commit de7962e against main's check, then commit ac4825f against a4810e6. The check was changed in b3c7e39 and then f099148. Each earlier row was counted again with the final tables: that check, with the final tables appended.

| Check | Must find | Must pass | Known misses (not found) |
|---|---|---|---|
| main b803f2b | **25 / 96** (commands 19/62, JavaScript 0/8, socket-line commands 2/2, script kinds 0/4, ways of giving the socket 4/19, N8 0/1) | 32 / 32 | 19 / 19 |
| a4810e6, the head the first review read | **80 / 96** (commands 54/62, JavaScript 6/8, socket-line commands 2/2, script kinds 0/4, ways of giving the socket 17/19, N8 1/1) | 32 / 32 | 19 / 19 |
| this branch (f099148) | **96 / 96** | 32 / 32 | 19 / 19 |

The review of PR #248's own probes, counted the same way. Its ids are kept in the test's table: P3 is `npm clean-install`, P4 `npm install-ci-test`, P5 `npm i`.

| | main b803f2b | this branch |
|---|---|---|
| Commands, P1-P8, P16, P17 | 3 / 10 (P1, P5, P6) | 10 / 10 |
| Ways of giving the socket: Q0, `--mount`, `//var/run/docker.sock`, Q1-Q4 | 3 / 7 | 7 / 7 |
| Q6, DOCKER_ARGS with the socket in a README code block | 0 / 1 | 1 / 1 |
| Q5, the socket given only on a command line outside the repository | 0 / 1 | 0 / 1 (known miss) |

The 19 known misses, each a tree in the test's known-miss table:

1. Q5: a launcher that takes `DOCKER_ARGS`, when the socket was passed only on a command line typed outside the repository. No file says the socket is given.
2. A socket path set in a file that another script sources (`. ./env.sh`). Variables are read one file at a time.
3. A command name built at run time (`c=n; ${c}pm ci`).
4. A heredoc given to the socket container (`docker run -i … sh <<'EOF'`, then `npm ci`). A heredoc's lines are not read as the container's commands.
5. `docker exec c npm ci` in a container started earlier with the socket (`docker run -d --name c …`). Containers are not tracked by name across lines.
6. `docker exec c sh /scripts/e2e.sh`, for the same reason.
7. `--volumes-from` a container that has the socket, for the same reason.
8. A compose file whose service mounts the socket under `volumes:` and runs `command: sh -c "npm ci"`. A service's other keys are not tied to its volumes.
9. A script with no extension (`sh /scripts/e2e2`). Only files with a script extension are followed.
10. `node /usr/local/lib/node_modules/npm/bin/npm-cli.js ci`. npm's own script is not read as npm.
11. `node "$(command -v npm)" ci`. A command substitution is a separate segment.
12. The whole command in a variable on the socket line (`INSTALL="npm ci"`, then `sh -c "cd /w && $INSTALL"`).
13. A JavaScript argument list over several lines (`spawnSync("npm", [` with `"ci",` on the next line). Lines are read one at a time.
14. A JavaScript argument list joined into a string (`["npm", "ci"].join(" ")`).
15. npm in a JavaScript variable (`const npm = "npm"; spawnSync(npm, ["ci"])`).
16. npm in a template string's variable (`` execSync(`${npm} ci`) ``).
17. `--privileged`. It gives the host's devices, not the socket, and is not looked at.
18. The rootless socket's folder (`-v /run/user/1000:/run/user/1000`). Only `/`, `/var`, `/run` and `/var/run` count as the socket's folder.
19. `DOCKER_HOST` inside an `--env-file`. Env files are not read.

The first review tried 41 forms of its own. It named 7 of them in blocking point 3 and more in point 4, and every named form is in a table here: as must-find where the check now finds it (a bash array, a socket folder in a variable, .ts, .mts and .bash scripts), and as a known miss otherwise. The forms it tried but did not name are not measured here.

Mutations of the test's code, each applied to the copy in the volume, run against bench-socket.test.ts, and undone. All 10 were caught:

| Mutation | Probes that failed |
|---|---|
| the seen key is the path only (R248's N8 undone) | 1 (N8) |
| `link` and `ln` out of the install list | 3 |
| `prune` out | 1 |
| `u` out | 1 |
| `audit … fix` not matched | 3 |
| a socket folder in a variable not counted | 1 |
| a bash array not read as a value | 1 |
| the earlier "only printed" rule (any name ending in `log`, any `.write`) | 2 |
| `\n` in a JavaScript string read as `n` | 1 |
| .bash, .ts, .mts and .cts not followed | 4 |

Mutations of the real tree, each applied to the copy in the volume, run against the check, and undone. All 8 were caught, and the control was not:

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
| M8 LV3's e2e.sh: `npm audit fix` (run at f099148; M1-M7 ran at b3c7e39) | docs/bench/2026-10-30-lv3-osv-publisher/scripts/e2e.sh:9 |

## Other checks (all in Docker)

The image was node:24, pinned by digest (sha256:e7add2a4…). The tree was copied into the volume ludion-lsock2-w, with `--memory 4g` and no socket. `npm ci --ignore-scripts` ran once with the network; everything else ran with `--network none`.

At f099148:

- tools/records/test/: 2 files, 166 tests passed.
- `npm run typecheck`: exit 0. `npm run build`: exit 0.
- `npm test -- --maxWorkers=2`: 43 files passed, 1646 tests passed, 25 skipped.

No e2e was run, and no container was given the socket.

## The record's "35 times" and the audit's 42

The mistake record says "Between 2026-10-29 and 2026-10-31 the e2e ran this way 35 times, all but one with the network on". It does not say how it counted. The review of PR #248 could not confirm 35 from the repository, which holds 23 committed e2e logs across the six folders.

The first-principles audit of 2026-11-01 counted differently. It read the agents' session records on the machine used (grep and awk only) and counted the calls that started a container given the socket: `docker run` lines containing `docker.sock`, and the `run.sh e2e` form. It found 42 runs of the six folders' e2e.sh, from 2026-10-29 11:02Z to 2026-10-31 13:54Z: LA 17, LB and LB2a 18, LV 2, LV3 2, LNODE 2, LIMGV 1. None of the 42 had `--network none`. The audit rated the count medium-confidence, because other ways of writing the command may have been missed.

The audit also found 5 more socket runs whose scripts are not in the repository. They ran from a job's temporary folder: 4 for LC and 1 for LV2. Each had no `npm ci`, or had it with `--ignore-scripts`. A check that reads the repository can never see such runs.

Why 35 differs from 42 is unknown. This lane did not count the session records again. It also did not check whether each of the 42 runs' e2e.sh lacked `--ignore-scripts` at that time.

## Where the Check sentence still claims more than the check

The record is not rewritten (CLAUDE.md, How we work). After this change, "follows every container started with the socket" and "an `npm ci`, `npm install` or similar" are still stronger than the check in these cases:

- **Outside the repository.** Containers started by scripts outside the repository, such as the 5 runs above, are not seen.
- **The 19 known misses above.** Each is a tree in the test that the check does not find. 4 to 9 are containers started with the socket, or scripts they run, that the check cannot follow. 10 to 16 are installs written in a form the check does not read. 1 to 3 and 17 to 19 are ways of giving the socket, or the host, that the check does not see.
- **A writable mount of the worktree.** It is not looked at. A container started that way can also reach the host. It is outside the forms this lane was given.
- **The project's own scripts.** pack, publish, version and the run family (`npm run build` among them, the mistake record's "Not fixed here") are not checked.

The check also errs the safe way in some forms, which is not counted here. It finds `npm ci` as the text of `grep -q "npm ci" log`, in the body of `cat <<'EOF'`, and in a JavaScript `const msg = "npm ci failed"`. It also finds an `npm ci` that follows `export npm_config_ignore_scripts=true` on an earlier line. And benchFiles follows symbolic links under docs/bench/, as on main.

The check is measured only against the tables above. A form in none of the tables has not been measured.
