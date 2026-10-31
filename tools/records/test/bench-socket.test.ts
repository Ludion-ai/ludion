// A container given the host's Docker socket (/var/run/docker.sock) can start containers that bind-mount the host's files,
// so whatever runs in it runs with the host's power. The bench scripts under docs/bench/ therefore never run an npm install
// with its install scripts on (or npx, npm exec, pnpm, yarn) where Docker can be reached: in a container started with the
// socket, in the scripts that container runs, or in a script that runs the docker CLI itself (which is either on the host
// or in such a container). docs/mistakes/2026-11-01-docker-sock-npm-ci.md.
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

/** Whether a script runs the docker CLI itself. */
function runsDocker(path: string, text: string): boolean {
  if (isJs(path)) return /["'`]docker["'`]/.test(text);
  return isShell(path) && lines(path, text).some(l => /(?<![\w./-])docker(?=\s|$|\))/.test(l.text));
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
    for (const l of lines(path, text)) {
      if (!SOCKET.test(l.text)) continue;
      if (l.code) check(path, l);
      for (const ref of referenced(path, l.text, files, mounts(l.text))) queue.push({ path: ref, mapped: mounts(l.text) });
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
  });
});
