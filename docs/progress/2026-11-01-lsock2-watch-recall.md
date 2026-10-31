# 2026-11-01 — LSOCK2: the bench-socket check, measured against the forms it must find and must pass

**Lane LSOCK2**, from main b803f2b. It follows up docs/mistakes/2026-11-01-docker-sock-npm-ci.md, which is not rewritten. No decision record: nothing in the goal, scope, gates, waits or rules changes, and Ludion's behaviour does not change, so docs/status.md does not change either.

## Why

The mistake record's Check says tools/records/test/bench-socket.test.ts "follows every container started with the socket" and "fails on an `npm ci`, `npm install` or similar without `--ignore-scripts`". The review of PR #248 tried other ways of writing the same mistake. The check at merge found 3 of its 10 command forms (P1-P17) and 3 of its 7 ways of giving the socket (Q0-Q4). The Check sentence claimed more than the check did.

## What changed

Only tools/records/test/bench-socket.test.ts. No file under docs/bench/ needed a change: the real tree passes the stronger check as it is.

- **The command.** All the npm commands that install, with every alias and typo npm accepts (`ci`, `clean-install`, `ic`, `install-clean`, `isntall-clean`, `install`, `i`, `in`, `ins`, `inst`, `insta`, `instal`, `isnt`, `isnta`, `isntal`, `isntall`, `add`, `install-test`, `it`, `install-ci-test`, `cit`, `clean-install-test`, `sit`, `rebuild`, `rb`, `update`, `up`, `upgrade`, `udpate`, `dedupe`, `ddp`). `--ignore-scripts false`, `=false`, `=0` and `--no-ignore-scripts` leave scripts on, and the last flag wins over an earlier one and over `npm_config_ignore_scripts`. Quotes are ignored (`npm "ci"`). npm can be given by its path (`/usr/local/bin/npm`), by a variable that holds it (`NPM=npm; $NPM ci`, `NPM=/usr/bin/npm`), or by a variable's default (`${NPM:-npm}`). A path counts only in a bin/ folder, so `dir=/e/npm` is not npm. `npm create` and `npm init <initializer>` count as package runners, as `npm exec` already did.
- **JavaScript.** In .mjs, .cjs, .js and .ts files, every string is read as a command (`execSync("npm ci")`, `spawnSync("sh", ["-c", "npx tsx x.ts"])`), and so is a program with its argument list (`execFileSync("npm", ["clean-install"])`). A string that is only printed (`console.log("npm ci exit", code)`) is not. A script whose strings run the docker CLI (`execSync("docker ps")`) counts as a docker client.
- **The socket.** A line gives the socket when it names `docker.sock` (as before), the Windows pipe `docker_engine`, or `DOCKER_HOST`, or bind-mounts `/`, `/var`, `/run` or `/var/run` (`-v`, `--volume`, `--mount source=`/`src=`). A variable that a file sets to such text makes every line that uses it a socket line (`SOCK=/var/run/docker.sock` then `-v "$SOCK:$SOCK"`). Such a variable is also passed to the scripts a socket line runs, together with that line's arguments. So `DOCKER_ARGS="-v /var/run/docker.sock:…" sh …/run.sh full` follows run.sh's `docker run ${DOCKER_ARGS:-} … sh "/scripts/$script.sh"` into full.sh. An exported variable is passed to every script the file runs.
- A script reached again with other mounts, variables or arguments is read again. Before, the first visit decided, which was the review's N8.

## The tables and the counts

The test has three tables of small made-up trees:

- **Must find:** 79 forms. A form counts as found when a finding names the expected file and line.
- **Must pass:** 25 forms. Nothing may be found.
- **Known miss:** 3 forms the check should find but cannot, because nothing written in the repository shows them. Each is asserted to be not found, so that a later fix shows up as a change in the test.

The 79 must-find forms are R248's P and Q probes, its R2 and R3 mutations, and the audit's npm aliases. They are grouped in four parts:

- 54 command forms: 6 flag forms, 31 aliases, P6, 3 forms of P7, 3 forms of P8, npm by its path and 9 package runners.
- 6 JavaScript forms, P16 and P17 among them.
- 2 commands started on the socket line itself (R2, R3).
- 17 ways of giving the socket: Q0 in 4 forms, Q1 in 5, Q2 in 2, Q3 in 2, Q4, and Q6 in 3.

The tables were written first, in commit de7962e, and run against main's check. Then the check was changed, in b3c7e39. The main row was counted again with the final tables: main's check with this branch's tables appended.

| Check | Must find | Must pass | Known misses (not found) |
|---|---|---|---|
| main b803f2b | **25 / 79** (command forms 19/54, JavaScript 0/6, socket-line commands 2/2, ways of giving the socket 4/17) | 25 / 25 | 3 / 3 |
| this branch (b3c7e39) | **79 / 79** | 25 / 25 | 3 / 3 |

The review's own probes, counted the same way:

| | main b803f2b | this branch |
|---|---|---|
| Commands, P1-P8, P16, P17 | 3 / 10 (P1, P5, P6) | 10 / 10 |
| Ways of giving the socket: Q0, `--mount`, `//var/run/docker.sock`, Q1-Q4 | 3 / 7 | 7 / 7 |
| Q6, DOCKER_ARGS with the socket in a README code block | 0 / 1 | 1 / 1 |
| Q5, the socket given only on a command line outside the repository | 0 / 1 | 0 / 1 (known miss) |

The known misses:

1. Q5: a launcher that takes `DOCKER_ARGS`, when the socket was passed only on a command line typed outside the repository. No file says the socket is given.
2. A socket path set in a file that another script sources (`. ./env.sh`). Variables are read one file at a time.
3. A command name built at run time (`c=n; ${c}pm ci`).

Mutations of the real tree, each applied to the copy in the volume, run against the check, and undone. 7 of 7 were caught, and the control was not:

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

## Other checks (all in Docker)

The image was node:24, pinned by digest (sha256:e7add2a4…). The tree was copied into the volume ludion-lsock2-w, with `--memory 4g` and no socket. `npm ci --ignore-scripts` ran once with the network; everything else ran with `--network none`.

- tools/records/test/: 2 files, 126 tests passed.
- `npm run typecheck`: exit 0. `npm run build`: exit 0.
- `npm test -- --maxWorkers=2`: 43 files passed, 1606 tests passed, 25 skipped.
- No e2e was run, and no container was given the socket.

## The record's "35 times" and the audit's 42

The mistake record says "Between 2026-10-29 and 2026-10-31 the e2e ran this way 35 times, all but one with the network on". It does not say how it counted. The review of PR #248 could not confirm 35 from the repository, which holds 23 committed e2e logs across the six folders.

The first-principles audit of 2026-11-01 counted differently. It read the agents' session records on the machine used (grep and awk only) and counted the calls that started a container given the socket: `docker run` lines containing `docker.sock`, and the `run.sh e2e` form. It found 42 runs of the six folders' e2e.sh, from 2026-10-29 11:02Z to 2026-10-31 13:54Z: LA 17, LB and LB2a 18, LV 2, LV3 2, LNODE 2, LIMGV 1. None of the 42 had `--network none`. The audit rated the count medium-confidence, because other ways of writing the command may have been missed.

The audit also found 5 more socket runs whose scripts are not in the repository. They ran from a job's temporary folder: 4 for LC and 1 for LV2. Each had no `npm ci`, or had it with `--ignore-scripts`. A check that reads the repository can never see such runs.

Why 35 differs from 42 is unknown. This lane did not count the session records again. It also did not check whether each of the 42 runs' e2e.sh lacked `--ignore-scripts` at that time.

## Where the Check sentence still claims more than the check

The record is not rewritten (CLAUDE.md, How we work). After this change, "follows every container started with the socket" is still stronger than the check in these cases:

- Containers started by scripts outside the repository, such as the 5 runs above, are not seen.
- The three known misses above.
- `--privileged`, and a writable mount of the worktree, are not looked at. A container started that way can also reach the host. They are outside the forms this lane was given.

The check is measured only against the tables above. A form in neither table has not been measured.
