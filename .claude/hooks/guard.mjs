// PreToolUse hook for Bash and PowerShell: refuses commands that change production or secrets, run a downloaded
// script, start a JavaScript or Python runtime on the host, or read a third-party repository's files on the host.
// settings.json denies the plain forms; this sees the whole command line and judges each command in it by what it
// runs, not by words that merely appear (a commit message or a grep pattern that mentions a deploy or node is fine).
// What it refuses and lets through, and its known holes: docs/decisions/2026-10-31-lguard-host-runtime-guard.md.
// In Bash it also refuses a backtick that would run as a command (runsBacktick). For Edit, Write and NotebookEdit it
// refuses writing in .claude/ (writesGuardFolder). Exit 2 blocks the call; so does any error (the try at the end), and
// settings.json's "onFailure": "block" covers a guard that cannot start or run at all.

// The tool's shell, set from the request at the end; the reader's functions read these.
let bash = true;
let ESCAPE = "\\";
// Node's own modules only, taken without an import: guard.mjs loads no other code (a test fixes it).
const fs = process.getBuiltinModule("node:fs");
const path = process.getBuiltinModule("node:path");
// Groups (( ), { }, $( )) nest at most this deep; deeper is refused before the reader's recursion could overflow.
const MAX_NESTING = 64;
let nesting = 0;

// PowerShell reads curly quotes as quotes, en and em dashes as "-", and a lone CR as a new line: read them so too. The
// Unicode line separators are taken as new lines, which cuts more and so judges more.
const powershellText = (text) =>
  text
      .replace(/[\u{201C}\u{201D}\u{201E}]/gu, '"')
      .replace(/[\u{2018}\u{2019}\u{201A}\u{201B}]/gu, "'")
      .replace(/[\u{2013}\u{2014}\u{2015}]/gu, "-")
      .replace(/\r\n?|[\u{85}\u{2028}\u{2029}]/gu, "\n");

/**
 * The commands a command line starts, read the way bash (or PowerShell) reads it: pipelines, each a list of stages
 * { words, stdin }. Quotes and escapes are removed and the quoted parts of one word joined (n'o'de is node). Lines are
 * cut at ; & && || | |& and new lines outside quotes; 2>&1 is a redirection. What runs inside ( ), { } and $( ), also
 * inside double quotes, an unquoted heredoc or a PowerShell @"…"@, comes out as pipelines of its own, and the group's
 * text stays in the word, so `iex (irm …)` still shows its download. A heredoc's body and a <<< word go to the stage's
 * stdin, a PowerShell here-string into its word: text, which check judges only when a shell reads it as its program.
 * A heredoc whose delimiter or terminator line cannot be read marks its stage unread. Space, tab and CR end a word (bash
 * keeps a CR in the word; cutting there only judges more), in PowerShell any white space. # begins a comment at the
 * start of a word after a space, tab, new line or ;&|()<> only, so a CR or another space before it hides nothing.
 * A backstop, not a parser.
 */
function lex(src) {
  const out = [];
  scan(src, 0, null, out);
  return out;
}

/**
 * The heredoc whose << ends just before i, as bash reads it: its delimiter word without quotes and backslashes,
 * literal when any part of the word was quoted, strip for <<-, and where the word ends. A word that cannot be read
 * (no word, an unclosed single quote, $'…', $"…", $( ), ${ }, $[ ] or a backtick, a new line inside it) gives unread:
 * bash reads such a word to its own end, which this does not try to match.
 */
function heredocWord(src, i) {
  const strip = src[i] === "-";
  if (strip) i++;
  while (src[i] === " " || src[i] === "\t") i++;
  let delim = "";
  let literal = false;
  for (; i < src.length && !" \t\n;&|<>()".includes(src[i]); i++) {
    const c = src[i];
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) return { unread: true, strip, end: src.length };
      delim += src.slice(i + 1, end);
      literal = true;
      i = end;
    } else if (c === '"') {
      literal = true;
      for (i++; i < src.length && src[i] !== '"'; i++) {
        if (src[i] === "\\" && i + 1 < src.length && "$`\"\\".includes(src[i + 1])) i++;
        delim += src[i];
      }
    } else if (c === "\\") {
      literal = true;
      i++;
      delim += src[i] ?? "";
    } else if (c === "`" || (c === "$" && i + 1 < src.length && "'\"({[".includes(src[i + 1]))) return { unread: true, strip, end: i };
    else delim += c;
  }
  return delim && !delim.includes("\n") ? { delim, literal, strip, end: i } : { unread: true, strip, end: i };
}

/** Read src from i up to closer (")" or "}") or its end, adding the pipelines found to out. Returns where it stopped. */
function scan(src, i, closer, out) {
  if (++nesting > MAX_NESTING) throw new RangeError(`groups nested deeper than ${MAX_NESTING}`);
  let pipeline = [];
  let stage = { words: [], stdin: [] };
  let word = null;
  let hereString = false;
  const pending = [];
  const add = (s) => (word = (word ?? "") + s);
  const endWord = () => {
    if (word !== null) (hereString ? stage.stdin : stage.words).push(word);
    if (word !== null) hereString = false;
    word = null;
  };
  const endStage = () => {
    endWord();
    if (stage.words.length || stage.stdin.length || stage.unread) pipeline.push(stage);
    stage = { words: [], stdin: [] };
  };
  const endPipeline = () => {
    endStage();
    if (pipeline.length) out.push(pipeline);
    pipeline = [];
  };
  for (; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    let h;
    if (c === closer) break;
    if (c === "\n") {
      endPipeline();
      if (pending.length) i = heredocBodies(src, i + 1, pending.splice(0), out) - 1;
    } else if (c === " " || c === "\t" || c === "\r" || (!bash && /\s/.test(c))) endWord();
    else if (c === "#" && word === null && (i === 0 || " \t\n;&|()<>".includes(src[i - 1]))) {
      const end = src.indexOf("\n", i);
      i = (end < 0 ? src.length : end) - 1;
    } else if (!bash && c === "<" && next === "#") {
      const end = src.indexOf("#>", i + 2);
      i = end < 0 ? src.length : end + 1;
    } else if (c === ESCAPE) {
      if (next !== "\n") add(next ?? "");
      i++;
    } else if (c === "'") {
      const end = src.indexOf("'", i + 1);
      const stop = end < 0 ? src.length : end;
      add(src.slice(i + 1, stop));
      i = stop;
    } else if (c === '"') {
      add("");
      i = doubleQuoted(src, i + 1, add, out);
    } else if (!bash && c === "@" && (next === "'" || next === '"') && /^[ \t]*\r?\n/.test(src.slice(i + 2))) {
      const start = src.indexOf("\n", i) + 1;
      const end = src.indexOf(`\n${next}@`, start - 1);
      const body = src.slice(start, end < 0 ? src.length : Math.max(end, start));
      add(body);
      if (next === '"') expansions(body, out);
      i = end < 0 ? src.length : end + 2;
    } else if (bash && src.startsWith("<<<", i)) {
      endWord();
      hereString = true;
      i += 2;
    } else if (bash && c === "<" && next === "<" && (h = heredocWord(src, i + 2))) {
      endWord();
      if (h.unread) stage.unread = true;
      else pending.push({ stage, ...h });
      i = h.end - 1;
    } else if ((c === "&" && next === "&") || (c === "|" && next === "|")) {
      endPipeline();
      i++;
    } else if (c === "|") {
      endStage();
      if (next === "&") i++;
    } else if (c === ";") endPipeline();
    else if (c === "&") {
      if (/[<>]$/.test(word ?? "") || next === ">") add(c);
      else endPipeline();
    } else if (c === "(" || c === "{") {
      const end = scan(src, i + 1, c === "(" ? ")" : "}", out);
      add(src.slice(i, end + 1));
      i = end;
    } else if (c === ")" || c === "}") endPipeline();
    else add(c);
  }
  endPipeline();
  nesting--;
  return i;
}

/** The text of a double-quoted string from i, given to add; what runs in its $( ) goes to out. Returns the closing quote. */
function doubleQuoted(src, i, add, out) {
  for (; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '"') return i;
    if (c === ESCAPE && next !== undefined && (!bash || "$`\"\\\n".includes(next))) {
      if (next !== "\n") add(next);
      i++;
    } else if (c === "$" && next === "(") {
      const end = scan(src, i + 2, ")", out);
      add(src.slice(i, end + 1));
      i = end;
    } else add(c);
  }
  return i;
}

/** What runs in the $( ) of text the shell expands (an unquoted heredoc, a PowerShell @"…"@): added to out. */
function expansions(text, out) {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ESCAPE) i++;
    else if (text[i] === "$" && text[i + 1] === "(") i = scan(text, i + 2, ")", out);
  }
}

/** Read the bodies of the heredocs in list, from the line at i, into their stages' stdin. Returns the next line's start. */
function heredocBodies(src, i, list, out) {
  for (const h of list) {
    const lines = [];
    let ended = false;
    while (i < src.length && !ended) {
      const end = src.indexOf("\n", i);
      const text = src.slice(i, end < 0 ? src.length : end);
      i = end < 0 ? src.length : end + 1;
      if ((h.strip ? text.replace(/^\t+/, "") : text) === h.delim) ended = true;
      else lines.push(text);
    }
    // With no terminator line, where bash ends the body cannot be told apart from what follows it.
    if (!ended) h.stage.unread = true;
    const body = lines.join("\n");
    h.stage.stdin.push(body);
    if (!h.literal) expansions(body, out);
  }
  return i;
}

/** A program's name as a command line names it: the file name, without its folder, a Windows extension, or case. */
const base = (word) => word.replace(/\\/g, "/").split("/").pop().replace(/\.(exe|cmd|bat|ps1|com|js|mjs)$/i, "").toLowerCase();

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const REDIRECT = /^(\d+|&)?(>>?|<)/;
const NOTHING = { name: "", args: [], runner: "", path: "" };

// Words that start the command named after them; their other options (wsl -e, --) are skipped. values: their options
// that take a value; before: plain words that come before the command (timeout's duration); none: options that mean
// nothing is run (command -v only looks); split: an option whose value is split into the command's words (env -S).
const WRAPPERS = new Map(Object.entries({
  sudo: { values: ["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U", "--user", "--group", "--host", "--prompt", "--chdir"] },
  doas: { values: ["-u", "-C"] },
  env: { values: ["-u", "-C", "--unset", "--chdir"], split: ["-S", "--split-string"] },
  time: { values: ["-f", "-o", "--format", "--output"] },
  exec: { values: ["-a"] },
  nice: { values: ["-n", "--adjustment"] },
  nohup: {},
  stdbuf: { values: ["-i", "-o", "-e", "--input", "--output", "--error"] },
  timeout: { values: ["-s", "-k", "--signal", "--kill-after"], before: 1 },
  xargs: { values: ["-I", "-n", "-L", "-P", "-s", "-d", "-E", "-a", "--arg-file", "--delimiter", "--max-args", "--max-procs", "--max-chars", "--max-lines", "--eof"] },
  command: { none: ["-v", "-V"] },
  builtin: {},
  call: {},
  wsl: { values: ["-d", "--distribution", "-u", "--user", "--cd", "--shell-type"] },
  if: {}, then: {}, else: {}, elif: {}, do: {}, while: {}, until: {}, "!": {}, coproc: {},
}));

/**
 * The program a command runs and its arguments, seeing through assignments, redirections, the words in WRAPPERS, npx
 * and node <path>/wrangler.js. runner is the program actually started (npx for `npx wrangler`); path is how it was named.
 */
function program(ws) {
  ws = [...ws];
  let i = 0;
  for (;;) {
    while (i < ws.length && (ASSIGN.test(ws[i]) || REDIRECT.test(ws[i]))) i += /^(\d+|&)?(>>?|<)&?$/.test(ws[i]) ? 2 : 1;
    if (!bash && /^\$[\w:.]+$/.test(ws[i] ?? "") && /^([-+*/%]|\?\?)?=$/.test(ws[i + 1] ?? "")) {
      i += 2;
      continue;
    }
    const w = WRAPPERS.get(base(ws[i] ?? ""));
    if (!w || i >= ws.length) break;
    let before = w.before ?? 0;
    for (i++; i < ws.length; ) {
      const a = ws[i];
      if (w.none?.includes(a)) return NOTHING;
      if (w.split?.includes(a)) ws.splice(i, 2, ...(ws[i + 1] ?? "").split(/\s+/).filter(Boolean));
      else if (w.values?.includes(a)) i += 2;
      else if (a.startsWith("-") && a.length > 1) i++;
      else if (before > 0) {
        before--;
        i++;
      } else break;
    }
  }
  const path = ws[i] ?? "";
  let name = base(path);
  let args = ws.slice(i + 1);
  const runner = name;
  if (name === "npx" || name === "pnpx" || name === "bunx") {
    const rest = args.filter((a) => !a.startsWith("-"));
    name = (rest[0] ?? "").toLowerCase();
    args = args.slice(args.indexOf(rest[0]) + 1);
  } else if (name === "node" && args[0] && /wrangler(\.js)?$/i.test(args[0].replace(/\\/g, "/"))) {
    name = "wrangler";
    args = args.slice(1);
  }
  return { name, args, runner, path };
}

const POSIX = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash"]);
const SHELLS = new Set([...POSIX, "pwsh", "powershell", "cmd"]);
const FETCHERS = new Set(["curl", "wget", "iwr", "irm", "invoke-webrequest", "invoke-restmethod"]);
const EVALS = new Set(["iex", "invoke-expression", "eval"]);
const ECHOES = new Set(["echo", "printf", "write-output", "write"]);
const STARTERS = new Set(["start-process", "saps", "start"]);
const RUNTIME = /^(node|nodejs|npm|npx|pnpm|pnpx|yarn|yarnpkg|bun|bunx|deno|tsx|vitest|corepack|python[0-9.]*|pythonw|pyw?|pip[0-9.]*|uvx?)$/;
const LIMIT = 4;

/** Where in a shell's arguments the flag stands that gives it a command string (-c, -Command, /c), or -1. */
function commandAt(name, args) {
  const flag = POSIX.has(name) ? /^-[A-Za-z]*c[A-Za-z]*$/ : name === "cmd" ? /^\/{1,2}[ck]$/i : /^[-/](c|co|com|comm|comma|comman|command|cwa|commandwithargs)$/i;
  return args.findIndex((a) => flag.test(a));
}

/** Whether this command reads its program from stdin: a shell or interpreter with no command string or script file, or an evaluator. */
function readsProgram(ws) {
  const { name, args } = program(ws);
  if (EVALS.has(name)) return true;
  if (!SHELLS.has(name) && !RUNTIME.test(name) && name !== "perl" && name !== "ruby") return false;
  if (args.includes("-") || (POSIX.has(name) && args.some((a) => /^-[A-Za-z]*s[A-Za-z]*$/.test(a)))) return true;
  return !args.some((a) => !a.startsWith("-")); // a command string (-c x, -e x) or a script file is a plain word
}

/** The program and arguments that Start-Process (saps, start) or cmd's start runs, or undefined. */
function started(args) {
  let file;
  let list;
  const plain = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (/^-[A-Za-z]/.test(a)) {
      const [flag, inline] = a.slice(1).toLowerCase().split(/:(.*)/);
      const value = inline ?? args[++k];
      if ("filepath".startsWith(flag) || flag === "path" || flag === "pspath") file = value;
      else if ("argumentlist".startsWith(flag) || flag === "args") list = value;
      else if (!["workingdirectory", "redirectstandardinput", "redirectstandardoutput", "redirectstandarderror", "verb", "windowstyle", "credential", "environment"].some((f) => flag.length > 1 && f.startsWith(flag)) && !["rsi", "rso", "rse", "wd"].includes(flag)) {
        if (inline === undefined) k--; // a switch, such as -Wait or -NoNewWindow
      }
    } else if (file === undefined && !plain.length && /^\/(d|node|affinity)$/i.test(a)) k++;
    else if (file === undefined && !plain.length && (/^\/[A-Za-z]+$/.test(a) || a === "")) continue; // cmd's /b, /wait, title "", before its program
    else plain.push(a);
  }
  file ??= plain.shift();
  if (list === undefined && plain.length) list = plain.join(" ");
  return file === undefined ? undefined : [file, ...(list ?? "").split(",").flatMap((s) => s.trim().split(/\s+/)).filter(Boolean)];
}

const OURS = (owner) => owner.toLowerCase() === "ludion-ai" || /^(\{owner\}|:owner)$/i.test(owner);
// After repos/OWNER/REPO/: the REST endpoints that return a repository's files or patches.
const FILES = /^(contents|readme|tarball|zipball)(\/|$)|^(compare|git\/blobs)\/|^commits\/[^/]+$|^pulls\/\d+\/files$/i;

/** The owner of a third-party repository whose files a GitHub API path or URL reads, or undefined. */
function filesOwner(target, headers) {
  const url = target.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const third = (owner) => (OURS(owner) ? undefined : owner);
  const api = /^(?:(?:https?:\/\/)?api\.github\.com)?\/?repos\/([^/]+)\/[^/]+(?:\/(.+))?$/i.exec(url);
  if (api) return api[2] !== undefined && (FILES.test(api[2]) || /diff|patch|raw|octet-stream/i.test(headers)) ? third(api[1]) : undefined;
  const m =
    /^(?:https?:\/\/)?(?:raw\.githubusercontent\.com|codeload\.github\.com)\/([^/]+)\//i.exec(url) ??
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/[^/]+\/(?:raw|blob|archive|commit|compare)\//i.exec(url) ??
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/[^/]+\/pull\/\d+(?:\.diff|\.patch|\/files)$/i.exec(url);
  return m ? third(m[1]) : undefined;
}

/** The owner of a repository named as OWNER/REPO, HOST/OWNER/REPO or a github.com URL, when it is not Ludion-ai's. */
function repoOwner(repo) {
  const m = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?github\.com[:/]([^/]+)\//i.exec(repo) ?? /^(?:[^/:]+\/)?([^/:]+)\/[^/]+$/.exec(repo);
  return m && !OURS(m[1]) ? m[1] : undefined;
}

/** What git clone reads from, when it is not a local path or a Ludion-ai repository on github.com. */
function cloneSource(url) {
  if (/^[A-Za-z]:[\\/]/.test(url) || /^file:/i.test(url) || !url.includes(":")) return undefined;
  const m = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?github\.com[:/]([^/]+)\//i.exec(url);
  return m ? (OURS(m[1]) ? undefined : m[1]) : url;
}

/** Whose repository's files this command reads onto the host, when they are not Ludion-ai's; or undefined. */
function thirdParty(name, args) {
  const sub = args.filter((a) => !a.startsWith("-"));
  const valueOf = (...flags) => {
    const at = args.findIndex((a) => flags.includes(a));
    if (at >= 0) return args[at + 1];
    const inline = args.find((a) => flags.some((f) => a.startsWith(`${f}=`)));
    return inline?.slice(inline.indexOf("=") + 1);
  };
  if (name === "gh" && sub[0] === "api") {
    const values = ["-X", "--method", "-H", "--header", "-f", "--raw-field", "-F", "--field", "-q", "--jq", "-t", "--template", "--input", "-p", "--preview", "--hostname", "--cache"];
    const headers = [];
    let endpoint;
    for (let k = args.indexOf("api") + 1; k < args.length; k++) {
      if (values.includes(args[k])) {
        if (args[k] === "-H" || args[k] === "--header") headers.push(args[k + 1] ?? "");
        k++;
      } else if (args[k].startsWith("--header=")) headers.push(args[k]);
      else if (!args[k].startsWith("-")) endpoint ??= args[k];
    }
    return endpoint === undefined ? undefined : filesOwner(endpoint, headers.join(" "));
  }
  if (name === "gh" && sub[0] === "repo" && sub[1] === "clone" && sub[2]) return repoOwner(sub[2]);
  if (name === "gh" && ((sub[0] === "pr" && (sub[1] === "diff" || sub[1] === "checkout")) || (sub[0] === "release" && sub[1] === "download"))) {
    const repo = valueOf("-R", "--repo") ?? sub.slice(2).find((a) => /github\.com\//i.test(a));
    return repo === undefined ? undefined : repoOwner(repo);
  }
  if (name === "git") {
    let k = 0;
    while (k < args.length && args[k].startsWith("-")) k += ["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(args[k]) ? 2 : 1;
    if (args[k] !== "clone") return undefined;
    const values = ["-b", "--branch", "-o", "--origin", "-u", "--upload-pack", "--reference", "--reference-if-able", "--separate-git-dir", "--depth", "--shallow-since", "--shallow-exclude", "-c", "--config", "-j", "--jobs", "--template", "--filter", "--bundle-uri", "--server-option"];
    for (k++; k < args.length; k++) {
      if (values.includes(args[k])) k++;
      else if (!args[k].startsWith("-")) return cloneSource(args[k]);
    }
    return undefined;
  }
  if (FETCHERS.has(name)) {
    const headers = args.filter((a, k) => /^(-H|--header|-headers?)$/i.test(args[k - 1] ?? "") || /^--header=/i.test(a)).join(" ");
    for (const a of args) {
      const owner = /^-/.test(a) ? undefined : filesOwner(a, headers);
      if (owner) return owner;
    }
  }
  return undefined;
}

const DOWNLOAD_RUN = "Running a downloaded script runs code nobody read. Download it, read it, then decide.";
const DEEP = "This command is nested too deep for the guard to read, so it cannot be judged. Run the inner command on its own.";
const ENCODED = "The guard cannot read a PowerShell -EncodedCommand. Pass the command as text.";
const UNREAD = "The guard cannot read this heredoc's delimiter, or it has no terminator line, so where its text ends cannot be judged. Use <<'EOF' and end it with a line that is exactly EOF.";
const hostRun = (named) => {
  const python = /^(python[0-9.]*|pythonw|pyw?|pip[0-9.]*|uvx?)$/.test(base(named));
  const example = python ? "python:3.14-slim python <script>" : "node:24 node <script>";
  return `${named.slice(0, 80)} on the host is refused: it would run with this machine's files and credentials. Run it inside Docker instead, for example: docker run --rm --network none -v <worktree>:/w -w /w ${example}. To see whether a program is installed, use command -v (Get-Command in PowerShell); to change files, use the editor's tools. docs/decisions/2026-10-31-lguard-host-runtime-guard.md`;
};
const THIRD_PARTY = (owner) =>
  `Reading the files of ${owner.slice(0, 80)}'s repository on the host is refused: third-party repositories are read only inside a container with no credentials (CLAUDE.md). For example: docker run --rm --read-only --cap-drop ALL curlimages/curl:8.11.1 -fsSL <url>.`;

/** Why one command is refused, or undefined. */
function refuse(ws, depth = 0) {
  if (depth > LIMIT) return DEEP;
  const p = program(ws);
  const { name, args } = p;
  const sub = args.filter((a) => !a.startsWith("-"));
  if (name === "wrangler") {
    const deploys = sub[0] === "deploy" || sub[0] === "rollback" || sub[0] === "delete" || (sub[0] === "versions" && (sub[1] === "deploy" || sub[1] === "upload"));
    if (deploys && !args.includes("--dry-run")) return "Production is deployed only by .github/workflows/deploy.yml. To deploy main's newest commit: gh workflow run deploy.yml --ref main. A dry run (--dry-run) is fine.";
    if (sub[0] === "secret" || (sub[0] === "versions" && sub[1] === "secret")) return "Secrets are set by the owner, never by Claude Code.";
  }
  if (name === "gh" && sub[0] === "secret") return "Secrets are set by the owner, never by Claude Code.";
  if (name === "gh" && sub[0] === "repo" && sub[1] === "delete") return "Deleting a repository is not allowed.";
  if (name === "git") {
    const at = args.indexOf("push");
    if (at >= 0) {
      const push = args.slice(at + 1);
      if (push.some((a) => a === "--force" || a.startsWith("--force-with-lease") || /^-[A-Za-z]*f[A-Za-z]*$/.test(a) || /^\+\S/.test(a))) return "Force pushes are not allowed. Push a new commit instead.";
    }
  }
  if (EVALS.has(name)) {
    if (args.some((a) => [...FETCHERS].some((f) => a.toLowerCase().includes(f)))) return DOWNLOAD_RUN;
    // eval and iex run their string as a command line.
    const why = args.length ? check(args.join(" "), depth + 1) : undefined;
    if (why) return why;
  }
  if (RUNTIME.test(p.runner) || /(^|\/)node_modules\//.test(p.path.replace(/\\/g, "/"))) return hostRun(p.path);
  const owner = thirdParty(name, args);
  if (owner) return THIRD_PARTY(owner);
  if (STARTERS.has(name)) {
    const target = started(args);
    const why = target && refuse(target, depth + 1);
    if (why) return why;
  }
  if (name === "find") {
    for (const [k, a] of args.entries()) {
      const why = /^-(exec|execdir|ok|okdir)$/.test(a) ? refuse(args.slice(k + 1), depth + 1) : undefined;
      if (why) return why;
    }
  }
  if ((name === "pwsh" || name === "powershell") && args.some((a) => /^[-/]e(c|n[a-z]*)?$/i.test(a))) return ENCODED;
  // A shell given a command string: judge it as a command line of its own, and its words as a command (cmd /c "C:\…\node.exe").
  if (SHELLS.has(name)) {
    const at = commandAt(name, args);
    const rest = at >= 0 ? args.slice(at + 1 + (args[at + 1] === "--" ? 1 : 0)) : [];
    const why = rest.length ? (refuse(rest, depth + 1) ?? check(rest.join(" "), depth + 1)) : undefined;
    if (why) return why;
  }
  return undefined;
}

/** Why a command line is refused, or undefined. depth counts the command strings it is nested in; refuse stops at LIMIT. */
function check(line, depth = 0) {
  for (const stages of lex(line)) {
    for (const [k, stage] of stages.entries()) {
      if (stage.unread) return UNREAD;
      const why = refuse(stage.words, depth);
      if (why) return why;
      // A shell or evaluator reading its program from stdin runs what it is fed: a heredoc, a here-string, or what the
      // stage before it in the pipe prints (echo, printf, a heredoc, a lone string). Judge it when it can be seen.
      if (stage.words.length && readsProgram(stage.words)) {
        const before = stages[k - 1];
        const fed = [...stage.stdin, ...(before?.stdin ?? [])];
        if (before && ECHOES.has(program(before.words).name)) fed.push(program(before.words).args.join(" "));
        else if (before?.words.length === 1) fed.push(before.words[0]);
        for (const text of fed) {
          const why = check(text, depth + 1);
          if (why) return why;
        }
      }
    }
    // A download piped into something that runs its input as a program.
    const fetchAt = stages.findIndex((s) => FETCHERS.has(program(s.words).name));
    if (fetchAt >= 0 && stages.slice(fetchAt + 1).some((s) => s.words.length && readsProgram(s.words))) {
      return "Piping a download into a shell runs code nobody read. Download it, read it, then decide.";
    }
  }
  return undefined;
}

/**
 * Whether bash would run a backtick in this command line as a command: one outside single quotes and outside the body
 * of a quoted heredoc (<<'EOF'). A markdown code span in double-quoted text (a PR body, a comment, a commit message)
 * runs this way; on 2026-10-29 one ran `npx webpack serve` on a host. $( ) is not refused: "$(cat <<'EOF' ... EOF)"
 * is how text is passed safely. It keeps a stack of what is open: single quotes, double quotes, and ( or $( ), also
 * a $( ) opened inside double quotes. A heredoc operator counts outside quotes or inside ( ) and $( ) only, so a <<
 * mentioned in double-quoted text is text; its delimiter is read as bash reads it (heredocWord). A backstop, not a
 * parser: it misses a backtick after an apostrophe in a # comment and inside $'...', and its reading of quotes can go
 * wrong after a ${…} holding quotes inside double quotes, or a case pattern's ) inside $( ) (open findings of the
 * security review of 4d97495; docs/decisions/2026-10-31-lguard-host-runtime-guard.md).
 */
function runsBacktick(line) {
  const open = [];
  const heredocs = [];
  let body = null;
  for (const text of line.split("\n")) {
    if (body) {
      if ((body.strip ? text.replace(/^\t+/, "") : text) === body.delim) body = heredocs.shift() ?? null;
      else if (!body.literal && /(^|[^\\])`/.test(text)) return true;
      continue;
    }
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const top = open.at(-1);
      if (top === "'") {
        if (c === "'") open.pop();
        continue;
      }
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === "`") return true;
      if (top === '"') {
        if (c === '"') open.pop();
        else if (c === "$" && text[i + 1] === "(") {
          open.push("(");
          i++;
        }
        continue;
      }
      if (c === '"' || c === "'" || c === "(") open.push(c);
      else if (c === ")" && top === "(") open.pop();
      else if (text.startsWith("<<<", i)) i += 2;
      else if (text.startsWith("<<", i)) {
        const h = heredocWord(text, i + 2);
        // A word it cannot read is not taken as a heredoc; check() refuses it.
        if (!h.unread) {
          heredocs.push(h);
          i = h.end - 1;
        }
      }
    }
    if (heredocs.length) body = heredocs.shift();
  }
  return false;
}

const BACKTICK = "A backtick outside single quotes runs as a command in bash, so a markdown code span inside double-quoted text runs on this machine. Write the text to a file and pass the file (--body-file, -F), or use a quoted heredoc (<<'EOF'); use $( ) for a command substitution you mean.";

/**
 * Whether a file that Edit, Write or NotebookEdit would write lies in .claude/ at the top of the git work tree holding
 * it: the nearest folder upwards with a .git file or folder, so a worktree under .claude/worktrees/ is its own tree.
 * Backslashes become slashes, .. is resolved, the deepest existing part goes through links and junctions (realpath),
 * and both sides are lowercased, since NTFS does not tell case apart.
 */
function writesGuardFolder(file) {
  const fold = (p) => p.replace(/\\/g, "/").toLowerCase();
  let existing = path.resolve(file.replace(/\\/g, "/"));
  const rest = [];
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) {
    rest.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  try {
    existing = fs.realpathSync.native(existing);
  } catch {
    // keep the path as written
  }
  const full = fold(path.join(existing, ...rest));
  for (let dir = existing; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git"))) return `${full}/`.startsWith(`${fold(dir).replace(/\/$/, "")}/.claude/`);
    if (path.dirname(dir) === dir) return false;
  }
}

const GUARD_FILES = "Files in .claude/ (the guard and its settings) change only through a reviewed PR that the owner merges, so Edit, Write and NotebookEdit there are refused in every worktree. docs/decisions/2026-10-31-lguard-host-runtime-guard.md";

try {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input || "{}");
  const tool = String(request.tool_name ?? "Bash");
  const command = String(request.tool_input?.command ?? "");
  bash = tool !== "PowerShell";
  ESCAPE = bash ? "\\" : "`";
  const file = request.tool_input?.file_path ?? request.tool_input?.notebook_path;
  // A write whose file cannot be named cannot be judged.
  const writes = ["Edit", "Write", "NotebookEdit"].includes(tool) && (typeof file !== "string" || writesGuardFolder(file));
  const why = (writes ? GUARD_FILES : undefined) ?? check(bash ? command : powershellText(command)) ?? (bash && runsBacktick(command) ? BACKTICK : undefined);
  if (why) {
    process.stderr.write(`Blocked by .claude/hooks/guard.mjs: ${why}\n`);
    process.exit(2);
  }
} catch (error) {
  process.stderr.write(`Blocked by .claude/hooks/guard.mjs: the guard could not read this command (${String(error?.message ?? error).slice(0, 120)}), so it is refused.\n`);
  process.exit(2);
}
