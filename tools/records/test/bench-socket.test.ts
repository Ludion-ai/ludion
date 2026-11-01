// A container given the host's Docker socket (/var/run/docker.sock) can start containers that bind-mount the host's files,
// so whatever runs in it runs with the host's power. The bench scripts under docs/bench/ therefore never run an npm install
// with its install scripts on (or npx, npm exec, pnpm, yarn) where Docker can be reached: in a container started with the
// socket (a docker run line, or a shell function holding one), in the scripts that container runs, or in a script that uses
// the docker CLI without starting containers (the shape of one run inside such a container, as the bench e2e.sh scripts).
// docs/mistakes/2026-11-01-docker-sock-npm-ci.md.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);

/** Script files a container can be told to run, and the files a socket mount can be written in. */
const SCRIPT = /\.(?:sh|bash|mjs|cjs|js|ts|mts|cts|ps1)$/;
const SCANNED = /(?:\.(?:sh|bash|mjs|cjs|js|ts|mts|cts|ps1|md|yml|yaml)|Dockerfile)$/;
const isShell = (path: string) => /\.(?:sh|bash|ps1)$/.test(path);
const isJs = (path: string) => /\.(?:mjs|cjs|js|ts|mts|cts)$/.test(path);

type Line = { n: number; text: string; code: boolean };

/** Logical lines (a trailing backslash joins the next), with comment lines left out; in Markdown, `code` marks fenced lines. */
function lines(path: string, text: string): Line[] {
  const out: Line[] = [];
  const raw = text.replace(/\r\n/g, "\n").split("\n");
  let fence = false;
  for (let i = 0; i < raw.length; i++) {
    let s = raw[i] ?? "";
    const n = i + 1;
    if (path.endsWith(".md") && /^\s*(?:```|~~~)/.test(s)) { fence = !fence; continue; }
    while (/\\\s*$/.test(s) && i + 1 < raw.length) s = s.replace(/\\\s*$/, " ") + (raw[++i] ?? "");
    if (isShell(path) && /^\s*#/.test(s)) continue;
    if (isJs(path) && /^\s*(?:\/\/|\/?\*)/.test(s)) continue;
    out.push({ n, text: s, code: !path.endsWith(".md") || fence });
  }
  return out;
}

/**
 * Text that gives a container the host's Docker: the socket or the Windows pipe by name, DOCKER_HOST, or a bind mount of a
 * folder the socket is in (`/`, `/var`, `/run`, `/var/run`).
 */
const SOCKET = /docker\.sock|docker_engine|DOCKER_HOST|(?:-v|--volume)(?:\s+|=)["']?\/{1,2}(?:var\/run|var|run)?\/?["']?:|\b(?:source|src)=["']?\/{1,2}(?:var\/run|var|run)?\/?["']?(?=[,\s"']|$)/;
/** A line that starts a container (or builds an image): what runs in it is socket-side only when the line passes the socket. */
// An option is `-[\w-]+` (which takes `--x` too), so each option matches only one way.
const STARTS_CONTAINER = /(?<![\w./-])docker(?:\s+-[\w-]+(?:=\S+)?)*\s+(?:run|create|build|buildx|compose)(?![\w-])/;

/**
 * Shell assignments in a text: `NAME=value`, `NAME="value"`, `NAME=$(command)`, `NAME=(a bash array)` (which may hold
 * `$(…)`), `NAME+=(…)`, `NAME[1]=value`, `export NAME=value`.
 */
function* assignments(text: string): Generator<{ name: string; value: string; exported: boolean }> {
  for (const m of text.matchAll(/(?:^|[\s;&|(`])(export\s+)?([A-Za-z_]\w*)(?:\[[^\]]*\])?\+?=("[^"]*"|'[^']*'|\((?:[^()]|\$\([^)]*\))*\)|\$\([^)]*\)|[^\s;&|)`]*)/gm)) yield { name: m[2] ?? "", value: (m[3] ?? "").replace(/^["'(]|["')]$/g, ""), exported: !!m[1] };
}

/** A folder the socket is in, as a variable's whole value (`SOCK_DIR=/var/run`). */
const SOCKET_FOLDER = /^\/{1,2}(?:var\/run|var|run)?\/?$/;

/**
 * The variables a file sets to text that gives the socket (`SOCK=/var/run/docker.sock`, `ARGS="-v …docker.sock…"`,
 * `args=(-v …docker.sock…)`), or to a folder the socket is in (`SOCK_DIR=/var/run`).
 */
function socketVars(text: string): { all: Set<string>; exported: Set<string> } {
  const all = new Set<string>(), exported = new Set<string>();
  for (const a of assignments(text)) if (SOCKET.test(a.value) || SOCKET_FOLDER.test(a.value)) { all.add(a.name); if (a.exported) exported.add(a.name); }
  return { all, exported };
}

const usesVar = (text: string, vars: Set<string>) => [...vars].some(v => new RegExp(`\\$\\{?${v}(?!\\w)`).test(text));
/** A line that gives the socket: by its text, or through a variable set to such text. */
const isSocket = (text: string, vars: Set<string>) => SOCKET.test(text) || usesVar(text, vars);

/** A program name, alone or with its path (`/usr/local/bin/npm`, `npm.cmd`), as a word of a command. */
const program = (names: string) => `(?<![\\w.-])(?:[\\w.~-]*\\/)*(?:${names})(?:\\.cmd|\\.exe)?(?![\\w.-])`;
const RUNNERS = "npx|bunx|pnpx|pnpm|yarn|npm|bun";
/**
 * npm's commands that change node_modules and so can run install scripts, with every alias and typo npm accepts: in npm
 * 11.19.1, the commands in lib/commands/ that call Arborist's reify, dedupe, prune or rebuild (ci, install, link,
 * uninstall, update, dedupe, prune, rebuild, and install-test and install-ci-test through install and ci), and audit with
 * fix (`npm audit fix`, matched apart). uninstall has no ignore-scripts option but reifies, so it runs the other packages'
 * install scripts too. Commands that run only the project's own scripts (run, test, start, stop, restart, pack, publish,
 * version) are not in this list.
 */
const INSTALLS = "ci|clean-install|ic|install-clean|isntall-clean|install|i|in|ins|inst|insta|instal|isnt|isnta|isntal|isntall|add|install-test|it|install-ci-test|cit|clean-install-test|sit|rebuild|rb|update|u|up|upgrade|udpate|dedupe|ddp|link|ln|prune|uninstall|unlink|remove|rm|r|un";
const INSTALL = new RegExp(`${program("npm")}(?:\\s+\\S+)*?\\s+(${INSTALLS}|audit(?:\\s+\\S+)*?\\s+fix)(?![\\w-])`);
const RUNNER = new RegExp([
  program("npx|bunx|pnpx|pnpm|yarn"),
  `${program("npm")}(?:\\s+-[\\w-]+)*\\s+(?:exec|x|create|innit|init(?=\\s+[^\\s-]))(?![\\w-])`,
  `${program("bun")}\\s+(?:install|i|add|x|create)(?![\\w-])`,
].join("|"));

/** Whether the words of an npm command leave install scripts on: npm_config_ignore_scripts, then the last flag, decide. */
function scriptsOn(words: string[]): boolean {
  const falsy = (v: string) => /^(?:false|null|0*)$/i.test(v);
  let on = true;
  for (const w of words) { const env = /^npm_config_ignore_scripts=(.*)$/i.exec(w); if (env) on = falsy(env[1] ?? ""); }
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? "", eq = /^--ignore-scripts=(.*)$/.exec(w);
    if (w === "--no-ignore-scripts") on = true;
    else if (eq) on = falsy(eq[1] ?? "");
    else if (w === "--ignore-scripts") {
      // npm reads a following true or false as the flag's value (`--ignore-scripts false`); 0 and null are taken as false.
      const next = words[i + 1] ?? "";
      if (/^(?:true|false|0|null)$/i.test(next)) { on = falsy(next); i++; } else on = false;
    }
  }
  return on;
}

/** The variables a file sets to a package manager (`NPM=npm`, `NPM=/usr/bin/npm`, `NPM=$(command -v npm)`), by name. */
function toolVars(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of assignments(text)) {
    // A path counts only in a bin/ folder: `dir=/e/npm` names a folder, not npm.
    const m = new RegExp(`^(?:\\$\\((?:command\\s+-v|which)\\s+)?(?:(?:[\\w.~-]*/)*bin/)?(${RUNNERS})\\)?$`).exec(a.value);
    if (m) out.set(a.name, m[1] ?? "");
  }
  return out;
}

/** The commands in a shell text that would run dependency code: an npm install with its scripts on, or a package runner. */
function shellForbidden(text: string, tools: Map<string, string>): string[] {
  const out: string[] = [];
  // A variable's default (`${NPM:-npm}`) and a variable holding a package manager (`$NPM`) are read as the name they give.
  let t = text.replace(/\$\{\w+:?[-=]([^}]*)\}/g, "$1");
  for (const [name, tool] of tools) t = t.replace(new RegExp(`\\$\\{${name}\\}|\\$${name}(?!\\w)`, "g"), tool);
  // A newline ends a command too (a string written to a shell's input: `"echo start\nnpm ci\n"`).
  for (const seg of t.split(/;|&&|\|\||\||\$\(|`|\n/)) {
    // Quotes do not change a command's words (`npm "ci"`, `sh -c "npm ci"`).
    const s = seg.replace(/["']/g, "").trim();
    if (/^(?:echo|printf|:)(?:\s|$)/.test(s)) continue;
    const install = INSTALL.exec(s);
    // npm reads no flags after `--` (`npm ci -- --ignore-scripts` runs the scripts).
    const words = s.split(/\s+/), at = words.findIndex(w => /(?:^|\/)npm(?:\.cmd|\.exe)?$/.test(w)), end = words.indexOf("--", at + 1);
    if (install && scriptsOn(end >= 0 ? words.slice(0, end) : words)) out.push(`npm ${install[1]} with install scripts`);
    const runner = RUNNER.exec(s);
    if (runner) out.push(runner[0].replace(/\s+/g, " "));
  }
  return out;
}

/** The string literals in a line of JavaScript, each with the text before it. */
function* strings(text: string): Generator<{ value: string; before: string; template: boolean }> {
  for (const m of text.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) yield { value: (m[1] ?? m[2] ?? m[3] ?? "").replace(/\\(.)/g, (_, c: string) => c === "n" ? "\n" : c === "t" ? "\t" : c), before: text.slice(0, m.index), template: m[3] !== undefined };
}

/** The commands in a line that would run dependency code: an npm install with its scripts on, or a package runner. */
function forbidden(path: string, text: string, tools: Map<string, string>): string[] {
  if (!isJs(path)) return shellForbidden(text, tools);
  const out: string[] = [];
  // A command in a string (`execSync("npm ci")`, `spawnSync("sh", ["-c", "npx tsx"])`), except one only printed.
  // Only console output, the process's own stdout and stderr, and an Error's message count as printed: a shell's stdin
  // (`sh.stdin.write("npm ci\n")`) or a helper whose name ends in log (`runAndlog("npm ci")`) can run it.
  for (const s of strings(text)) {
    if (!/(?:\bconsole\.\w+|\bprocess\.std(?:out|err)\.write|\bError)\(\s*$/.test(s.before)) out.push(...shellForbidden(s.value, new Map()));
    // A template string's `${…}` parts are code that runs, even when the template is only printed
    // (`console.log(`out: ${execSync("npm ci")}`)`).
    if (s.template) for (const e of s.value.matchAll(/\$\{([^}]*)\}/g)) out.push(...forbidden(path, e[1] ?? "", tools));
  }
  // A program and its argument list (`execFileSync("npm", ["ci", "--no-audit"])`), read as one command.
  for (const m of text.matchAll(new RegExp(`(["'\`])((?:[\\w.~-]*/)*(?:${RUNNERS}))\\1\\s*,\\s*\\[([^\\]]*)\\]`, "g"))) out.push(...shellForbidden([m[2] ?? "", ...[...strings(m[3] ?? "")].map(s => s.value)].join(" "), new Map()));
  for (const m of text.matchAll(/["'`](npx|pnpm|yarn|bunx|pnpx)["'`]/g)) out.push(m[1] ?? "");
  // npm_config_ignore_scripts set in the child's environment turns install scripts off.
  return /npm_config_ignore_scripts["']?\s*:\s*["'`]?(?:true|1)\b/i.test(text) ? out.filter(f => !f.endsWith("with install scripts")) : out;
}

/**
 * Whether a script runs the docker CLI as a client of a Docker it was given, and starts no container itself: the shape of
 * a script run inside a container that has the socket (e2e.sh's `$(docker --version)`). A script that starts containers is
 * a launcher on the host; what it starts with the socket is found from its socket lines, and what it starts without the
 * socket is not socket-side.
 */
function runsDocker(path: string, text: string): boolean {
  if (isJs(path)) {
    const all = [...strings(text)].map(s => s.value);
    const client = /["'`]docker["'`]/.test(text) || all.some(s => /^docker\s/.test(s));
    return client && !/["'`](?:run|create|compose)["'`]/.test(text) && !all.some(s => STARTS_CONTAINER.test(s));
  }
  if (!isShell(path)) return false;
  const code = lines(path, text);
  return code.some(l => /(?<![\w./-])docker(?=\s|$|\))/.test(l.text)) && !code.some(l => STARTS_CONTAINER.test(l.text));
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

/** Mount points a socket line maps to another bench folder's scripts (`-v …/docs/bench/<folder>/scripts:/lnode:ro`). */
function mounts(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/(docs\/bench\/[\w./-]+?)\/?:(\/[\w-]+)(?=[:\s"']|$)/g)) out.set(m[2] ?? "", m[1] ?? "");
  return out;
}

type Ref = { path: string; args: string[] };

/**
 * The script files a line names, resolved in the tree: by their docs/bench/ path, through a mount, next to the file, or in
 * its folder's scripts/. A name built from a variable (`"/scripts/$script.sh"`) is tried with each argument the script
 * was given. Each script comes with the words after it on the line, the arguments it is given.
 */
function referenced(path: string, text: string, files: Map<string, string>, mapped: Map<string, string>, args: string[] = []): Ref[] {
  const out: Ref[] = [];
  // A variable in a name is `${name}` or a whole `$name`, so each part of the name matches only one way (no backtracking).
  for (const m of text.matchAll(/(?<![\w.-])((?:[\w.${}()-]*\/)*)((?:[\w.-]|\$\{\w+\}|\$\w+(?!\w))+\.(?:sh|bash|mjs|cjs|js|ts|mts|cts|ps1))(?![\w.])/g)) {
    const prefix = m[1] ?? "", written = m[2] ?? "";
    const names = written.includes("$") ? args.map(a => written.replace(/\$\{?\w+\}?/g, a)) : [written];
    const mount = /^\/([\w-]+)\//.exec(prefix)?.[1];
    const bench = prefix.indexOf("docs/bench/");
    const rest = (text.slice((m.index ?? 0) + m[0].length).split(/[;&|)]/)[0] ?? "").replace(/["']/g, "");
    const given = rest.split(/\s+/).filter(w => /^[\w.@/-]+$/.test(w) && !w.startsWith("-"));
    for (const name of names) {
      const tries = [
        ...(bench >= 0 ? [`${prefix.slice(bench)}${name}`] : []),
        ...(mount && mapped.has(`/${mount}`) ? [`${mapped.get(`/${mount}`)}/${name}`] : []),
        `${dirOf(path)}/${name}`,
        `${dirOf(path)}/scripts/${name}`,
      ];
      const hit = tries.find(t => files.has(t));
      if (hit && SCRIPT.test(hit)) out.push({ path: hit, args: given });
    }
  }
  return out;
}

/**
 * Every command under docs/bench/ that would run an npm install with scripts on, or a package runner, where Docker can be
 * reached. `files` maps repository paths to their text. Each finding is `path:line: what`.
 */
export function socketFindings(files: Map<string, string>): string[] {
  const findings = new Set<string>();
  const seen = new Set<string>();
  type Item = { path: string; mapped: Map<string, string>; vars: Set<string>; args: string[] };
  const queue: Item[] = [];
  const tools = new Map<string, Map<string, string>>();
  const toolsOf = (path: string) => { if (!tools.has(path)) tools.set(path, toolVars(files.get(path) ?? "")); return tools.get(path)!; };
  const check = (path: string, l: Line) => { for (const f of forbidden(path, l.text, toolsOf(path))) findings.add(`${path}:${l.n}: ${f}`); };
  const follow = (path: string, text: string, mapped: Map<string, string>, vars: Set<string>, args: string[] = []) => {
    for (const ref of referenced(path, text, files, mapped, args)) queue.push({ path: ref.path, mapped, vars, args: ref.args });
  };

  for (const [path, text] of files) {
    // A line that passes the socket: what it runs, and the command it starts, are socket-side. A variable the file sets to
    // the socket is passed on to the scripts such a line runs (`DOCKER_ARGS="-v …docker.sock…" sh run.sh full`); one it
    // exports is passed on to every script it runs.
    const all = lines(path, text);
    const { all: vars, exported } = socketVars(text);
    for (const l of all) {
      const socket = isSocket(l.text, vars);
      if (!socket) { if (exported.size && l.code) follow(path, l.text, new Map(), vars); continue; }
      if (l.code) check(path, l);
      follow(path, l.text, mounts(l.text), vars);
      // A shell function that passes the socket (`run() { docker run -v …docker.sock… img sh -c "$1"; }`): every call of it
      // is socket-side too.
      const fn = isShell(path) ? /^\s*(?:function\s+)?([\w-]+)\s*\(\)\s*\{/.exec(l.text)?.[1] : undefined;
      if (!fn) continue;
      const call = new RegExp(`(?:^|[;&|({]|\\bthen|\\bdo|\\belse)\\s*${fn}(?=\\s|$)`);
      for (const c of all) if (c !== l && call.test(c.text)) {
        check(path, c);
        follow(path, c.text, mounts(l.text), vars);
      }
    }
    // A script that runs the docker CLI can reach Docker wherever it runs.
    if (SCRIPT.test(path) && runsDocker(path, text)) queue.push({ path, mapped: new Map(), vars: new Set(), args: [] });
  }

  while (queue.length) {
    const item = queue.shift()!;
    // The same script reached with other mounts, variables or arguments is read again.
    const key = JSON.stringify([item.path, [...item.mapped], [...item.vars].sort(), item.args]);
    if (seen.has(key)) continue;
    seen.add(key);
    const text = files.get(item.path) ?? "";
    const vars = new Set([...item.vars, ...socketVars(text).all]);
    for (const l of lines(item.path, text)) {
      // What a socket-less container started from here runs is not socket-side.
      if (STARTS_CONTAINER.test(l.text) && !isSocket(l.text, vars)) continue;
      check(item.path, l);
      follow(item.path, l.text, item.mapped, vars, item.args);
    }
  }
  return [...findings].sort();
}

function benchFiles(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(new URL(dir, root))) {
      const path = `${dir}${name}`;
      if (statSync(new URL(path, root)).isDirectory()) { if (!["raw", "logs", "node_modules"].includes(name)) walk(`${path}/`); }
      else if (SCANNED.test(name)) out.set(path, readFileSync(new URL(path, root), "utf8"));
    }
  };
  walk("docs/bench/");
  return out;
}

describe("docs/bench/ and the Docker socket", () => {
  it("runs no npm install with install scripts, and no npx, where a container has the host's Docker socket", () => {
    expect(socketFindings(benchFiles())).toEqual([]);
  });

  const B = "docs/bench/x/scripts";
  const files = (entries: Record<string, string>) => new Map(Object.entries(entries));

  it("finds an npm ci in a script a socket container runs, and in the scripts that script runs", () => {
    const run = `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$here:/scripts:ro" img sh /scripts/e2e.sh "$@"\n`;
    expect(socketFindings(files({ [`${B}/run.sh`]: run, [`${B}/e2e.sh`]: "sh /scripts/build.sh\nnode /w/cli.js\n", [`${B}/build.sh`]: "cd /w\nnpm ci --no-audit --no-fund >/tmp/ci.log 2>&1; echo \"npm ci exit $?\"\n" })))
      .toEqual([`${B}/build.sh:2: npm ci with install scripts`]);
    // The same flow with --ignore-scripts passes; the echo that names npm ci is not a command.
    expect(socketFindings(files({ [`${B}/run.sh`]: run, [`${B}/e2e.sh`]: "npm ci --ignore-scripts --no-audit; echo \"npm ci exit $?\"\nnpm install --package-lock-only --ignore-scripts\n" }))).toEqual([]);
    // npm install, npm i, an option before the command, and npx.
    expect(socketFindings(files({ [`${B}/run.sh`]: run, [`${B}/e2e.sh`]: "npm install\n(cd d && npm i lodash)\nnpm --prefix /w ci\nnpx vitest run\nnpm exec tsc\n" }))).toEqual([
      `${B}/e2e.sh:1: npm install with install scripts`,
      `${B}/e2e.sh:2: npm i with install scripts`,
      `${B}/e2e.sh:3: npm ci with install scripts`,
      `${B}/e2e.sh:4: npx`,
      `${B}/e2e.sh:5: npm exec`,
    ]);
  });

  it("finds an npm ci in a script that runs the docker CLI, though no file names the socket", () => {
    expect(socketFindings(files({ [`${B}/e2e.sh`]: "echo \"$(docker --version)\"\nnpm ci --no-audit --no-fund\n" }))).toEqual([`${B}/e2e.sh:2: npm ci with install scripts`]);
    expect(socketFindings(files({ [`${B}/e2e.mjs`]: "spawnSync(\"docker\", [\"ps\"]);\nspawnSync(\"npm\", [\"ci\"]);\n" }))).toEqual([`${B}/e2e.mjs:2: npm ci with install scripts`]);
    // Without the docker CLI and the socket, an npm ci is not this check's (a socket-less container may run it).
    expect(socketFindings(files({ [`${B}/test.sh`]: "npm ci --no-audit --no-fund\n" }))).toEqual([]);
  });

  it("follows a socket line in a README's code block across its continued lines, and a mount of another folder's scripts", () => {
    const readme = ["```sh", "docker run --rm \\", "  -v C:/dev/x/docs/bench/y/scripts:/other:ro \\", "  -v /var/run/docker.sock:/var/run/docker.sock \\", "  img sh /scripts/e2e.sh", "```", ""].join("\n");
    expect(socketFindings(files({
      "docs/bench/x/README.md": readme,
      [`${B}/e2e.sh`]: "node /other/helper.mjs\nnode /scripts/summary.mjs\n",
      "docs/bench/y/scripts/helper.mjs": "spawnSync(\"npx\", [\"tsx\"]);\n",
      [`${B}/summary.mjs`]: "console.log(1);\n",
    }))).toEqual(["docs/bench/y/scripts/helper.mjs:1: npx"]);
    // The command a socket line starts is checked too, in a script and in a README's code block, not in its prose.
    expect(socketFindings(files({ [`${B}/run.sh`]: "docker run -v /var/run/docker.sock:/var/run/docker.sock img npm ci\n" }))).toEqual([`${B}/run.sh:1: npm ci with install scripts`]);
    expect(socketFindings(files({ "docs/bench/x/README.md": "```\ndocker run -v /var/run/docker.sock:/var/run/docker.sock img sh -c 'npm ci'\n```\n" }))).toEqual(["docs/bench/x/README.md:2: npm ci with install scripts"]);
    expect(socketFindings(files({ "docs/bench/x/README.md": "The e2e ran with -v /var/run/docker.sock:/var/run/docker.sock after npm ci.\n" }))).toEqual([]);
  });

  it("does not follow what a host script runs in a socket-less container, nor count comments", () => {
    const run = [
      "# e2e.sh runs npm ci with the socket (comment only)",
      "test) docker run --rm -v \"$here:/scripts:ro\" img sh /scripts/test.sh ;;",
      "ci) docker run --rm img npm ci --no-audit ;;",
      "e2e) docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v \"$here:/scripts:ro\" img sh /scripts/e2e.sh ;;",
      "",
    ].join("\n");
    expect(socketFindings(files({ [`${B}/run.sh`]: run, [`${B}/test.sh`]: "npm ci\n", [`${B}/e2e.sh`]: "# npm ci would run here\nnode /w/cli.js\n" }))).toEqual([]);
    // A launcher that wraps a socket-less docker run in a function: what it passes the function runs in that container.
    const check = "run() { docker run --rm --network none -v \"$W:/w:ro\" img sh -c \"$1\"; }\nrun \"npx vitest run tools/shadow\"\n";
    expect(socketFindings(files({ [`${B}/check.sh`]: check }))).toEqual([]);
    // The same launcher with the socket in the function is found.
    expect(socketFindings(files({ [`${B}/check.sh`]: check.replace("--network none", "-v /var/run/docker.sock:/var/run/docker.sock") }))).toEqual([`${B}/check.sh:2: npx`]);
  });
});

// The forms the check must find and the forms it must pass, as small trees. The must-find table holds the review's probes
// of PR #248 (P1-P17 for the command, Q0-Q6 for the ways of giving the socket, R2-R3 its mutations), every alias of the
// npm commands in INSTALLS, and the forms the review of PR #249 named. A form this check cannot see is in the known-miss
// table, asserted not found, so that the recall in docs/progress/2026-11-01-lsock2-watch-recall.md counts it and a later
// fix shows up here. A form in none of the tables has not been measured.
describe("bench-socket recall", () => {
  const D = "docs/bench/x/scripts";
  const SOCK = "-v /var/run/docker.sock:/var/run/docker.sock";
  const tree = (entries: Record<string, string>) => new Map(Object.entries(entries));
  /** A launcher that runs e2e.sh in a container started with `flags`, and e2e.sh with `cmd` on its second line. */
  const e2e = (cmd: string, flags = SOCK) => ({
    [`${D}/run.sh`]: `docker run --rm ${flags} -v "$here:/scripts:ro" img sh /scripts/e2e.sh\n`,
    [`${D}/e2e.sh`]: `node /w/cli.js\n${cmd}\n`,
  });
  /** The same, with e2e.sh running github.mjs, which holds `code`. */
  const mjs = (code: string) => ({ ...e2e("node /scripts/github.mjs"), [`${D}/github.mjs`]: `${code}\n` });
  const AT_E2E = `${D}/e2e.sh:2`;

  type Probe = [id: string, files: Record<string, string>, where: string];
  const ALIASES = ["ci", "clean-install", "ic", "install-clean", "isntall-clean", "install", "i", "in", "ins", "inst", "insta", "instal", "isnt", "isnta", "isntal", "isntall", "add", "install-test", "it", "install-ci-test", "cit", "clean-install-test", "sit", "rebuild", "rb", "update", "u", "up", "upgrade", "udpate", "dedupe", "ddp", "link", "ln", "prune", "uninstall", "unlink", "remove", "rm", "r", "un"];
  /** The id the review of PR #248 gave a probe of an alias, or "alias". */
  const aliasId = (a: string) => ({ "clean-install": "P3", "install-ci-test": "P4", i: "P5" } as Record<string, string>)[a] ?? "alias";
  /** A launcher whose socket container runs `script`, and the script holding `body`. */
  const runs = (script: string, body: string, how = "sh") => ({
    [`${D}/run.sh`]: `docker run --rm ${SOCK} -v "$here:/scripts:ro" img ${how} /scripts/${script}\n`,
    [`${D}/${script}`]: `${body}\n`,
  });
  const MUST_FIND: Probe[] = [
    // The command: an install with its scripts on, written another way.
    ["P1 --ignore-scripts=false", e2e("npm ci --ignore-scripts=false"), AT_E2E],
    ["P2 --ignore-scripts false", e2e("npm ci --ignore-scripts false"), AT_E2E],
    ["P2 --no-ignore-scripts", e2e("npm ci --no-ignore-scripts"), AT_E2E],
    ["P2 --no-ignore-scripts after --ignore-scripts", e2e("npm ci --ignore-scripts --no-audit --no-ignore-scripts"), AT_E2E],
    ["P2 --ignore-scripts=0", e2e("npm ci --ignore-scripts=0"), AT_E2E],
    ["P2 a flag over the environment", e2e("npm_config_ignore_scripts=true npm ci --ignore-scripts=false"), AT_E2E],
    ...ALIASES.map((a): Probe => [`${aliasId(a)} npm ${a}`, e2e(`npm ${a} --no-audit`), AT_E2E]),
    ["npm link a folder", e2e("npm link ../pkg"), AT_E2E],
    ["npm audit fix", e2e("npm audit fix"), AT_E2E],
    ["npm audit fix --force", e2e("npm audit fix --force --no-fund"), AT_E2E],
    ["npm audit fix with an option first", e2e("npm --prefix /w audit fix"), AT_E2E],
    ["npm audit fix with an option between", e2e("npm audit --json fix"), AT_E2E],
    ["--ignore-scripts after --, which npm does not read as a flag", e2e("npm ci -- --ignore-scripts"), AT_E2E],
    ["P6 a continued line", e2e("npm \\\n  ci --no-audit"), AT_E2E],
    ["P7 npm in a variable", e2e("NPM=npm; $NPM ci"), AT_E2E],
    ["P7 a path in a variable", e2e("NPM=/usr/bin/npm\n\"${NPM}\" clean-install"), `${D}/e2e.sh:3`],
    ["P7 a variable's default", e2e("${NPM:-npm} ci"), AT_E2E],
    ["P7 npm from command -v", e2e("NPM=$(command -v npm)\n\"$NPM\" ci"), `${D}/e2e.sh:3`],
    ["P8 npm \"ci\"", e2e("npm \"ci\""), AT_E2E],
    ["P8 \"npm\" ci", e2e("\"npm\" ci"), AT_E2E],
    ["P8 'npm' 'install'", e2e("'npm' 'install'"), AT_E2E],
    ["npm by its path", e2e("/usr/local/bin/npm ci"), AT_E2E],
    // Package runners.
    ["npx", e2e("npx tsx x.ts"), AT_E2E],
    ["npx by its path", e2e("/usr/local/bin/npx tsx x.ts"), AT_E2E],
    ["npm exec", e2e("npm --yes exec tsc"), AT_E2E],
    ["npm x", e2e("npm x tsc"), AT_E2E],
    ["npm create", e2e("npm create vite@latest app"), AT_E2E],
    ["npm init <initializer>", e2e("npm init vite app"), AT_E2E],
    ["pnpm", e2e("pnpm install"), AT_E2E],
    ["yarn", e2e("yarn"), AT_E2E],
    ["bunx", e2e("bunx tsc"), AT_E2E],
    // The command in a JavaScript string that a socket-side script runs.
    ["P16 execSync(\"npm ci\")", mjs("execSync(\"npm ci --no-audit\");"), `${D}/github.mjs:1`],
    ["P16 a template string", mjs("execSync(`npm clean-install`);"), `${D}/github.mjs:1`],
    ["P17 sh -c with npx", mjs("spawnSync(\"sh\", [\"-c\", \"npx tsx x.ts\"]);"), `${D}/github.mjs:1`],
    ["P17 an alias in an argument list", mjs("execFileSync(\"npm\", [\"clean-install\", \"--no-audit\"]);"), `${D}/github.mjs:1`],
    ["P17 --ignore-scripts false in an argument list", mjs("execFileSync(\"npm\", [\"ci\", \"--ignore-scripts\", \"false\"]);"), `${D}/github.mjs:1`],
    ["a script that runs the docker CLI in a string", { [`${D}/e2e.mjs`]: "execSync(\"docker ps\");\nexecSync(\"npm ci\");\n" }, `${D}/e2e.mjs:2`],
    ["a command written to a shell's input", mjs("sh.stdin.write(\"npm ci\\n\");"), `${D}/github.mjs:1`],
    ["a command passed to a function whose name ends in log", mjs("runAndlog(\"npm ci\");"), `${D}/github.mjs:1`],
    ["a command on a later line of a shell's input", mjs("sh.stdin.write(\"echo start\\nnpm ci\\n\");"), `${D}/github.mjs:1`],
    ["a command run inside a printed template string", mjs("console.log(`out: ${execSync(\"npm ci --no-audit\")}`);"), `${D}/github.mjs:1`],
    ["an argument list in a .mts script", runs("e2e.mts", "spawnSync(\"npm\", [\"ci\"]);", "node"), `${D}/e2e.mts:1`],
    ["an argument list in a .cts script", runs("e2e.cts", "spawnSync(\"npm\", [\"ci\"]);", "node"), `${D}/e2e.cts:1`],
    // Scripts the socket container runs, by their kind.
    ["a .ts script", runs("e2e.ts", "execSync(\"npm ci\");", "node"), `${D}/e2e.ts:1`],
    ["a .mts script", runs("e2e.mts", "execSync(\"npm ci\");", "node"), `${D}/e2e.mts:1`],
    ["a .cts script", runs("e2e.cts", "execSync(\"npm ci\");", "node"), `${D}/e2e.cts:1`],
    ["a .bash script", runs("e2e.bash", "npm ci", "bash"), `${D}/e2e.bash:1`],
    // The command a socket line starts (R2, R3).
    ["R2 sh -c npx on the socket line", { [`${D}/run.sh`]: `docker run --rm ${SOCK} img sh -c "npx tsx /scripts/x.ts"\n` }, `${D}/run.sh:1`],
    ["R3 a README code block", { "docs/bench/x/README.md": `\`\`\`sh\ndocker run --rm ${SOCK} img sh -c "npm install"\n\`\`\`\n` }, "docs/bench/x/README.md:2"],
    // The ways of giving the socket, each to a container that runs e2e.sh with npm ci.
    ["Q0 -v the socket", e2e("npm ci"), AT_E2E],
    ["Q0 --mount the socket", e2e("npm ci", "--mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock"), AT_E2E],
    ["Q0 -v //var/run/docker.sock", e2e("npm ci", "-v //var/run/docker.sock:/var/run/docker.sock"), AT_E2E],
    ["Q0 the Windows pipe", e2e("npm ci", "-v //./pipe/docker_engine://./pipe/docker_engine"), AT_E2E],
    ["Q1 -v /var/run:/var/run", e2e("npm ci", "-v /var/run:/var/run"), AT_E2E],
    ["Q1 -v /run:/run", e2e("npm ci", "-v /run:/run"), AT_E2E],
    ["Q1 --volume=/var/run/", e2e("npm ci", "--volume=/var/run/:/var/run"), AT_E2E],
    ["Q1 --mount src=/var/run", e2e("npm ci", "--mount type=bind,src=/var/run,dst=/var/run"), AT_E2E],
    ["Q1 -v /var", e2e("npm ci", "-v /var:/hostvar"), AT_E2E],
    ["Q2 -e DOCKER_HOST=tcp", e2e("npm ci", "-e DOCKER_HOST=tcp://host.docker.internal:2375"), AT_E2E],
    ["Q2 --env DOCKER_HOST", e2e("npm ci", "--env DOCKER_HOST"), AT_E2E],
    ["Q3 the socket's path in a variable", {
      [`${D}/run.sh`]: "SOCK=/var/run/docker.sock\ndocker run --rm -v \"$SOCK:$SOCK\" -v \"$here:/scripts:ro\" img sh /scripts/e2e.sh\n",
      [`${D}/e2e.sh`]: "npm ci\n",
    }, `${D}/e2e.sh:1`],
    ["Q3 the mount in a variable", {
      [`${D}/run.sh`]: `ARGS="${SOCK}"\ndocker run --rm $ARGS img sh /scripts/e2e.sh\n`,
      [`${D}/e2e.sh`]: "npm ci\n",
    }, `${D}/e2e.sh:1`],
    ["Q3 the mount in a bash array", {
      [`${D}/run.sh`]: `args=(${SOCK})\ndocker run --rm "\${args[@]}" -v "$here:/scripts:ro" img sh /scripts/e2e.sh\n`,
      [`${D}/e2e.sh`]: "npm ci\n",
    }, `${D}/e2e.sh:1`],
    ["Q3 a bash array with $(pwd) in it", {
      [`${D}/run.sh`]: `args=(-v "$(pwd)/x:/x" ${SOCK})\ndocker run --rm "\${args[@]}" -v "$here:/scripts:ro" img sh /scripts/e2e.sh\n`,
      [`${D}/e2e.sh`]: "npm ci\n",
    }, `${D}/e2e.sh:1`],
    ["Q3 a bash array added to with +=", {
      [`${D}/run.sh`]: `args=()\nargs+=(${SOCK})\ndocker run --rm "\${args[@]}" -v "$here:/scripts:ro" img sh /scripts/e2e.sh\n`,
      [`${D}/e2e.sh`]: "npm ci\n",
    }, `${D}/e2e.sh:1`],
    ["Q3 an element of a bash array", {
      [`${D}/run.sh`]: "args[1]=/var/run/docker.sock:/var/run/docker.sock\ndocker run --rm -v \"${args[1]}\" -v \"$here:/scripts:ro\" img sh /scripts/e2e.sh\n",
      [`${D}/e2e.sh`]: "npm ci\n",
    }, `${D}/e2e.sh:1`],
    ["Q3 the socket's folder from a command substitution", {
      [`${D}/run.sh`]: "SOCK_DIR=$(dirname /var/run/docker.sock)\ndocker run --rm -v \"$SOCK_DIR:/var/run\" -v \"$here:/scripts:ro\" img sh /scripts/e2e.sh\n",
      [`${D}/e2e.sh`]: "npm ci\n",
    }, `${D}/e2e.sh:1`],
    ["Q3 the socket's folder in a variable", {
      [`${D}/run.sh`]: "SOCK_DIR=/var/run\ndocker run --rm -v \"$SOCK_DIR:/var/run\" -v \"$here:/scripts:ro\" img sh /scripts/e2e.sh\n",
      [`${D}/e2e.sh`]: "npm ci\n",
    }, `${D}/e2e.sh:1`],
    ["Q4 -v /:/host", e2e("npm ci", "-v /:/host"), AT_E2E],
    ["Q6 DOCKER_ARGS in a README code block", {
      "docs/bench/x/README.md": `\`\`\`sh\nIMAGE=runner DOCKER_ARGS="${SOCK}" sh docs/bench/x/scripts/run.sh full\n\`\`\`\n`,
      [`${D}/run.sh`]: "set -u\nscript=$1; shift\ndocker run --rm ${DOCKER_ARGS:-} -v \"$(pwd)/$here:/scripts:ro\" \"$image\" sh \"/scripts/$script.sh\" \"$@\"\n",
      [`${D}/full.sh`]: "npm ci --no-audit\n",
    }, `${D}/full.sh:1`],
    ["Q6 DOCKER_ARGS exported in a launcher", {
      [`${D}/all.sh`]: `export DOCKER_ARGS="${SOCK}"\nsh docs/bench/x/scripts/run.sh full\n`,
      [`${D}/run.sh`]: "script=$1; shift\ndocker run --rm ${DOCKER_ARGS:-} img sh \"/scripts/$script.sh\"\n",
      [`${D}/full.sh`]: "npm ci --no-audit\n",
    }, `${D}/full.sh:1`],
    ["Q6 a README prose line naming the script", {
      "docs/bench/x/README.md": `- \`scripts/e2e.sh\` (image runner, \`DOCKER_ARGS="${SOCK}"\`)\n`,
      [`${D}/e2e.sh`]: "npm ci\n",
    }, `${D}/e2e.sh:1`],
    // The review of PR #249: the same launcher reached twice with other arguments is read again (R248's N8).
    ["N8 one launcher run with two arguments", {
      "docs/bench/x/README.md": `\`\`\`sh\nDOCKER_ARGS="${SOCK}" sh docs/bench/x/scripts/run.sh test\nDOCKER_ARGS="${SOCK}" sh docs/bench/x/scripts/run.sh full\n\`\`\`\n`,
      [`${D}/run.sh`]: "script=$1; shift\ndocker run --rm ${DOCKER_ARGS:-} img sh \"/scripts/$script.sh\"\n",
      [`${D}/test.sh`]: "echo ok\n",
      [`${D}/full.sh`]: "npm ci\n",
    }, `${D}/full.sh:1`],
    // The same launcher reached first without the socket's variable, then with it (the variables in the key).
    ["N8 one launcher reached without, then with, the socket's variable", {
      "docs/bench/x/README.md": `Socket: ${SOCK}, scripts/run.sh full\n`,
      [`${D}/all.sh`]: `DOCKER_ARGS="${SOCK}" sh docs/bench/x/scripts/run.sh full\n`,
      [`${D}/run.sh`]: "script=$1; shift\ndocker run --rm ${DOCKER_ARGS:-} img sh \"/scripts/$script.sh\"\n",
      [`${D}/full.sh`]: "npm ci\n",
    }, `${D}/full.sh:1`],
    // The same script reached first with no mounts (it runs the docker CLI), then with another folder's scripts mounted.
    ["N8 one script reached without, then with, a mount", {
      [`${D}/e2e.sh`]: "echo \"$(docker --version)\"\nnode /other/helper.mjs\n",
      "docs/bench/x/README.md": `\`\`\`sh\ndocker run --rm -v C:/dev/x/docs/bench/y/scripts:/other:ro ${SOCK} -v "$here:/scripts:ro" img sh /scripts/e2e.sh\n\`\`\`\n`,
      "docs/bench/y/scripts/helper.mjs": "spawnSync(\"npx\", [\"tsx\"]);\n",
    }, "docs/bench/y/scripts/helper.mjs:1"],
  ];

  const MUST_PASS: [id: string, files: Record<string, string>][] = [
    ["npm ci --ignore-scripts", e2e("npm ci --ignore-scripts --no-audit --no-fund >/tmp/ci.log 2>&1; echo \"npm ci exit $?\"")],
    ["--ignore-scripts=true", e2e("npm ci --ignore-scripts=true")],
    ["--ignore-scripts true", e2e("npm clean-install --ignore-scripts true")],
    ["--ignore-scripts last", e2e("npm ci --no-ignore-scripts --ignore-scripts")],
    ["--ignore-scripts before the command", e2e("npm --ignore-scripts ci")],
    ["npm_config_ignore_scripts=true", e2e("npm_config_ignore_scripts=true npm ci")],
    ["--package-lock-only --ignore-scripts", e2e("npm install --package-lock-only --ignore-scripts")],
    ["printf naming an install", e2e("printf '%s\\n' \"npm clean-install\"")],
    ["npm run build (the record's Not fixed here)", e2e("npm run build -w ludion-ai >/tmp/build.log 2>&1; echo \"build exit $?\"")],
    ["npm test, typecheck, --version", e2e("npm test; npm run typecheck; npm --version")],
    ["the built CLI", e2e("node \"$CLI\" patch --dir \"$dir\" --apply; echo \"patch exit $?\"")],
    ["a folder named npm", e2e("dir=/e/npm; rm -rf \"$dir\"; mkdir -p /e; cp -r /w/examples/npm-security \"$dir\"")],
    ["a folder named npm in a variable", e2e("dir=/e/npm\ngit -C \"$dir\" init -q && git -C \"$dir\" add -A")],
    ["git init", e2e("git init -q /e/x")],
    ["a comment", e2e("# npm ci")],
    ["console.log naming npm ci", mjs("console.log(\"npm ci exit\", code);")],
    ["an argument list with --ignore-scripts", mjs("spawnSync(\"npm\", [\"ci\", \"--ignore-scripts\"]);")],
    ["a string with --ignore-scripts", mjs("execSync(\"npm ci --ignore-scripts\");")],
    ["no socket", e2e("npm ci", "--network none")],
    ["a volume at /var/run", e2e("npm ci", "-v ludion-x:/var/run")],
    ["another folder under /var/run", e2e("npm ci", "-v /var/run/postgresql:/var/run/postgresql")],
    ["the worktree read-only", e2e("npm ci", "-v \"$(pwd):/src:ro\" -v /w:/w")],
    ["DOCKER_ARGS without the socket", {
      "docs/bench/x/README.md": "```sh\nDOCKER_ARGS=\"--network none\" sh docs/bench/x/scripts/run.sh full\n```\n",
      [`${D}/run.sh`]: "script=$1; shift\ndocker run --rm ${DOCKER_ARGS:-} img sh \"/scripts/$script.sh\"\n",
      [`${D}/full.sh`]: "npm ci\n",
    }],
    ["a README prose line", { "docs/bench/x/README.md": `The e2e ran with ${SOCK} after npm ci.\n` }],
    ["a socket-less container from a host script", { [`${D}/run.sh`]: "docker run --rm img npm ci --no-audit\n" }],
    ["npm audit (a report only)", e2e("npm audit; npm audit --json; npm audit signatures")],
    ["npm audit fix --ignore-scripts", e2e("npm audit fix --ignore-scripts")],
    ["npm pack (the project's own scripts, as npm run)", e2e("npm pack --dry-run")],
    ["a folder variable that holds no socket", {
      [`${D}/run.sh`]: "DIR=/var/lib\ndocker run --rm -v \"$DIR:/x\" -v \"$here:/scripts:ro\" img sh /scripts/e2e.sh\n",
      [`${D}/e2e.sh`]: "npm ci\n",
    }],
    ["process.stdout.write naming npm ci", mjs("process.stdout.write(\"npm ci exit\\n\");")],
    ["an Error naming npm ci", mjs("throw new Error(\"npm ci failed\");")],
    ["a comment in a .bash script", runs("e2e.bash", "# npm ci would run here\nnode /w/cli.js", "bash")],
    ["a .ts script a socket-less container runs", {
      [`${D}/run.sh`]: "docker run --rm --network none -v \"$here:/scripts:ro\" img node /scripts/e2e.ts\n",
      [`${D}/e2e.ts`]: "execSync(\"npm ci\");\n",
    }],
  ];

  const KNOWN_MISSES: [id: string, files: Record<string, string>, why: string][] = [
    ["Q5 the socket given only on a command line outside the repository", {
      [`${D}/run.sh`]: "script=$1; shift\ndocker run --rm ${DOCKER_ARGS:-} img sh \"/scripts/$script.sh\"\n",
      [`${D}/e2e.sh`]: "npm ci\n",
    }, "no file under docs/bench/ says the socket is given"],
    ["Q3 the socket's path set in a sourced file", {
      [`${D}/env.sh`]: "SOCK=/var/run/docker.sock\n",
      [`${D}/run.sh`]: ". ./env.sh\ndocker run --rm -v \"$SOCK:$SOCK\" img sh /scripts/e2e.sh\n",
      [`${D}/e2e.sh`]: "npm ci\n",
    }, "variables are read per file"],
    ["P7 a command name built at run time", e2e("c=n; ${c}pm ci"), "the name is not written out"],
    // The review of PR #249 (blocking 3 and non-blocking 4): containers and commands this check cannot follow.
    ["a heredoc given to the socket container", {
      [`${D}/run.sh`]: `docker run -i --rm ${SOCK} img sh <<'EOF'\nnpm ci\nEOF\n`,
    }, "a heredoc's lines are not read as the container's commands"],
    ["docker exec in a container started with the socket", {
      [`${D}/run.sh`]: `docker run -d --name c ${SOCK} img sleep infinity\ndocker exec c npm ci\n`,
    }, "containers are not tracked by name across lines"],
    ["docker exec of a script", {
      [`${D}/run.sh`]: `docker run -d --name c ${SOCK} img sleep infinity\ndocker exec c sh /scripts/e2e.sh\n`,
      [`${D}/e2e.sh`]: "npm ci\n",
    }, "containers are not tracked by name across lines"],
    ["--volumes-from a container with the socket", {
      [`${D}/run.sh`]: `docker run -d --name s ${SOCK} img sleep infinity\ndocker run --rm --volumes-from s img sh /scripts/e2e.sh\n`,
      [`${D}/e2e.sh`]: "npm ci\n",
    }, "containers are not tracked by name across lines"],
    ["a compose file", {
      "docs/bench/x/compose.yml": "services:\n  e2e:\n    image: img\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n    command: sh -c \"npm ci\"\n",
    }, "a compose service's other keys are not tied to its volumes"],
    ["a script with no extension", runs("e2e2", "npm ci"), "only files ending in .sh, .bash, .mjs, .cjs, .js, .ts, .mts, .cts or .ps1 are followed"],
    ["a Python script", runs("e2e.py", "subprocess.run([\"npm\", \"ci\"])", "python3"), "only files ending in .sh, .bash, .mjs, .cjs, .js, .ts, .mts, .cts or .ps1 are followed"],
    ["npm-cli.js run by node", e2e("node /usr/local/lib/node_modules/npm/bin/npm-cli.js ci"), "npm's own script is not read as npm"],
    ["node \"$(command -v npm)\" ci", e2e("node \"$(command -v npm)\" ci"), "a command substitution is a separate segment"],
    ["the command in a variable on the socket line", {
      [`${D}/run.sh`]: `INSTALL="npm ci"\ndocker run --rm ${SOCK} img sh -c "cd /w && $INSTALL"\n`,
    }, "a variable holding a whole command is not expanded"],
    ["an argument list over several lines", mjs("spawnSync(\"npm\", [\n  \"ci\",\n]);"), "lines are read one at a time"],
    ["an argument list joined", mjs("execSync([\"npm\", \"ci\"].join(\" \"));"), "the words are separate strings"],
    ["npm in a JavaScript variable", mjs("const npm = \"npm\"; spawnSync(npm, [\"ci\"]);"), "JavaScript variables are not followed"],
    ["npm in a template string's variable", mjs("execSync(`${npm} ci`);"), "JavaScript variables are not followed"],
    ["--privileged", e2e("npm ci", "--privileged"), "it gives the host's devices, not the socket, and is not looked at"],
    ["the rootless socket's folder", e2e("npm ci", "-v /run/user/1000:/run/user/1000"), "only /, /var, /run and /var/run count as the socket's folder"],
    ["DOCKER_HOST in an --env-file", { ...e2e("npm ci", "--env-file /scripts/docker.env"), "docs/bench/x/scripts/docker.env": "DOCKER_HOST=tcp://host.docker.internal:2375\n" }, "env files are not read"],
  ];

  it.each(MUST_FIND)("finds %s", (_id, files, where) => {
    expect(socketFindings(tree(files)).filter(f => f.startsWith(`${where}: `))).not.toEqual([]);
  });
  it.each(MUST_PASS)("passes %s", (_id, files) => {
    expect(socketFindings(tree(files))).toEqual([]);
  });
  it.each(KNOWN_MISSES)("does not find %s (a known miss)", (_id, files) => {
    expect(socketFindings(tree(files))).toEqual([]);
  });
});
