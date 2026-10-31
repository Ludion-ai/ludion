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
const SCRIPT = /\.(?:sh|mjs|cjs|js|ps1)$/;
const SCANNED = /(?:\.(?:sh|mjs|cjs|js|ts|ps1|md|yml|yaml)|Dockerfile)$/;
const isShell = (path: string) => /\.(?:sh|ps1)$/.test(path);
const isJs = (path: string) => /\.(?:mjs|cjs|js|ts)$/.test(path);

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

const SOCKET = /docker\.sock/;
/** A line that starts a container (or builds an image): what runs in it is socket-side only when the line passes the socket. */
const STARTS_CONTAINER = /(?<![\w./-])docker(?:\s+-{1,2}[\w-]+(?:=\S+)?)*\s+(?:run|create|build|buildx|compose)(?![\w-])/;

/** The commands in a line that would run dependency code: an npm install with its scripts on, or a package runner. */
function forbidden(path: string, text: string): string[] {
  const out: string[] = [];
  if (isJs(path)) {
    for (const m of text.matchAll(/["'`](npm)["'`]\s*,\s*\[\s*["'`](ci|install|i|add|rebuild|update)["'`]/g)) if (!/ignore[-_]scripts/.test(text)) out.push(`${m[1]} ${m[2]}`);
    for (const m of text.matchAll(/["'`](npx|pnpm|yarn|bunx|pnpx)["'`]/g)) out.push(m[1] ?? "");
    return out;
  }
  for (const seg of text.split(/;|&&|\|\||\||\$\(|`/)) {
    const s = seg.trim();
    if (/^(?:echo|printf|:)(?:\s|$)/.test(s)) continue;
    const install = /(?<![\w./-])npm(?![\w-])(?:\s+\S+)*?\s+(ci|install|i|in|add|isntall|rebuild|update|up|upgrade)(?![\w-])/.exec(s);
    if (install && !/--ignore-scripts(?!=false)|npm_config_ignore_scripts=(?:true|1)\b/i.test(s)) out.push(`npm ${install[1]} with install scripts`);
    const runner = /(?<![\w./-])(?:npx|bunx|pnpx|pnpm|yarn)(?![\w-])|(?<![\w./-])npm(?:\s+-{1,2}[\w-]+)*\s+(?:exec|x)(?![\w-])|(?<![\w./-])bun\s+(?:install|i|add|x)(?![\w-])/.exec(s);
    if (runner) out.push(runner[0].replace(/\s+/g, " "));
  }
  return out;
}

/**
 * Whether a script runs the docker CLI as a client of a Docker it was given, and starts no container itself: the shape of
 * a script run inside a container that has the socket (e2e.sh's `$(docker --version)`). A script that starts containers is
 * a launcher on the host; what it starts with the socket is found from its socket lines, and what it starts without the
 * socket is not socket-side.
 */
function runsDocker(path: string, text: string): boolean {
  if (isJs(path)) return /["'`]docker["'`]/.test(text) && !/["'`](?:run|create|compose)["'`]/.test(text);
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

/** The script files a line names, resolved in the tree: through a mount, next to the file, or in its folder's scripts/. */
function referenced(path: string, text: string, files: Map<string, string>, mapped: Map<string, string>): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\w.-])((?:[\w.${}()-]*\/)*)([\w.-]+\.(?:sh|mjs|cjs|js|ps1))(?![\w.])/g)) {
    const prefix = m[1] ?? "", name = m[2] ?? "";
    const mount = /^\/([\w-]+)\//.exec(prefix)?.[1];
    const tries = [
      ...(mount && mapped.has(`/${mount}`) ? [`${mapped.get(`/${mount}`)}/${name}`] : []),
      `${dirOf(path)}/${name}`,
      `${dirOf(path)}/scripts/${name}`,
    ];
    const hit = tries.find(t => files.has(t));
    if (hit && SCRIPT.test(hit)) out.push(hit);
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
  const queue: { path: string; mapped: Map<string, string> }[] = [];
  const check = (path: string, l: Line) => { for (const f of forbidden(path, l.text)) findings.add(`${path}:${l.n}: ${f}`); };

  for (const [path, text] of files) {
    // A line that passes the socket: what it runs, and the command it starts, are socket-side.
    const all = lines(path, text);
    for (const l of all) {
      if (!SOCKET.test(l.text)) continue;
      if (l.code) check(path, l);
      for (const ref of referenced(path, l.text, files, mounts(l.text))) queue.push({ path: ref, mapped: mounts(l.text) });
      // A shell function that passes the socket (`run() { docker run -v …docker.sock… img sh -c "$1"; }`): every call of it
      // is socket-side too.
      const fn = isShell(path) ? /^\s*(?:function\s+)?([\w-]+)\s*\(\)\s*\{/.exec(l.text)?.[1] : undefined;
      if (!fn) continue;
      const call = new RegExp(`(?:^|[;&|({]|\\bthen|\\bdo|\\belse)\\s*${fn}(?=\\s|$)`);
      for (const c of all) if (c !== l && call.test(c.text)) {
        check(path, c);
        for (const ref of referenced(path, c.text, files, mounts(l.text))) queue.push({ path: ref, mapped: mounts(l.text) });
      }
    }
    // A script that runs the docker CLI can reach Docker wherever it runs.
    if (SCRIPT.test(path) && runsDocker(path, text)) queue.push({ path, mapped: new Map() });
  }

  while (queue.length) {
    const { path, mapped } = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    for (const l of lines(path, files.get(path) ?? "")) {
      // What a socket-less container started from here runs is not socket-side.
      if (STARTS_CONTAINER.test(l.text) && !SOCKET.test(l.text)) continue;
      check(path, l);
      for (const ref of referenced(path, l.text, files, mapped)) queue.push({ path: ref, mapped });
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
    expect(socketFindings(files({ [`${B}/e2e.mjs`]: "spawnSync(\"docker\", [\"ps\"]);\nspawnSync(\"npm\", [\"ci\"]);\n" }))).toEqual([`${B}/e2e.mjs:2: npm ci`]);
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
// of PR #248 (P1-P17 for the command, Q0-Q6 for the ways of giving the socket, R2-R3 its mutations) and every npm alias
// of an install that runs scripts. A form this check cannot see is in the known-miss table, asserted not found, so that the
// recall in docs/progress/2026-11-01-lsock2-watch-recall.md counts it and a later fix shows up here.
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
  const ALIASES = ["ci", "clean-install", "ic", "install-clean", "isntall-clean", "install", "i", "in", "ins", "inst", "insta", "instal", "isnt", "isnta", "isntal", "isntall", "add", "install-test", "it", "install-ci-test", "cit", "clean-install-test", "sit", "rebuild", "rb", "update", "up", "upgrade", "udpate", "dedupe", "ddp"];
  const MUST_FIND: Probe[] = [
    // The command: an install with its scripts on, written another way.
    ["P1 --ignore-scripts=false", e2e("npm ci --ignore-scripts=false"), AT_E2E],
    ["P2 --ignore-scripts false", e2e("npm ci --ignore-scripts false"), AT_E2E],
    ["P2 --no-ignore-scripts", e2e("npm ci --no-ignore-scripts"), AT_E2E],
    ["P2 --no-ignore-scripts after --ignore-scripts", e2e("npm ci --ignore-scripts --no-audit --no-ignore-scripts"), AT_E2E],
    ["P2 --ignore-scripts=0", e2e("npm ci --ignore-scripts=0"), AT_E2E],
    ["P2 a flag over the environment", e2e("npm_config_ignore_scripts=true npm ci --ignore-scripts=false"), AT_E2E],
    ...ALIASES.map((a): Probe => [`P3 npm ${a}`, e2e(`npm ${a} --no-audit`), AT_E2E]),
    ["P6 a continued line", e2e("npm \\\n  ci --no-audit"), AT_E2E],
    ["P7 npm in a variable", e2e("NPM=npm; $NPM ci"), AT_E2E],
    ["P7 a path in a variable", e2e("NPM=/usr/bin/npm\n\"${NPM}\" clean-install"), `${D}/e2e.sh:3`],
    ["P7 a variable's default", e2e("${NPM:-npm} ci"), AT_E2E],
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
