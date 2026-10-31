// Mutation run for LGUARD (docs/bench/2026-10-31-lguard/README.md). Run it in Docker only, on a copy of the repository
// (node mutate.mjs <copy> <output file>): for each mutation it changes one rule of .claude/hooks/guard.mjs in the copy,
// runs the guard's tests, and puts the file back. A mutation is caught when the tests fail. The run starts with the
// unchanged file, whose tests must pass; a mutation whose text is not found exactly once is "not applied".
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [, , root = "/w", outFile = "/out/mutations.txt"] = process.argv;
const target = `${root}/.claude/hooks/guard.mjs`;
const original = readFileSync(target, "utf8");
const R = String.raw;

/** [id, the rule it turns off, text in guard.mjs, its replacement] */
const M = [];

// Runtime names: one mutation per name drops it (or, for a pattern, the names it adds).
const alts = ["node", "nodejs", "npm", "npx", "pnpm", "pnpx", "yarn", "yarnpkg", "bun", "bunx", "deno", "tsx", "vitest", "corepack", "python[0-9.]*", "pythonw", "pyw?", "pip[0-9.]*", "uvx?"];
const line = (list) => R`const RUNTIME = /^(` + list.join("|") + ")$/;";
const variants = { "python[0-9.]*": ["python", "python[0-9.]+"], "pyw?": ["py", "pyw"], "pip[0-9.]*": ["pip", "pip[0-9.]+"], "uvx?": ["uv", "uvx"] };
for (const alt of alts) {
  for (const to of variants[alt] ?? [null]) {
    const list = to === null ? alts.filter((a) => a !== alt) : alts.map((a) => (a === alt ? to : a));
    M.push([`N-${to ?? alt}`, `runtime name: ${alt}${to === null ? " dropped" : ` narrowed to ${to}`}`, line(alts), line(list)]);
  }
}

M.push(
  // How a program is named.
  ["B1", "base: backslash folders", R`word.replace(/\\/g, "/").split("/").pop()`, R`word.split("/").pop()`],
  ["B2", "base: folder dropped", R`.split("/").pop().replace(`, R`.replace(`],
  ["B3", "base: .exe", R`/\.(exe|cmd|bat|ps1|com|js|mjs)$/i`, R`/\.(cmd|bat|ps1|com|js|mjs)$/i`],
  ["B4", "base: .cmd", R`/\.(exe|cmd|bat|ps1|com|js|mjs)$/i`, R`/\.(exe|bat|ps1|com|js|mjs)$/i`],
  ["B5", "base: .bat", R`/\.(exe|cmd|bat|ps1|com|js|mjs)$/i`, R`/\.(exe|cmd|ps1|com|js|mjs)$/i`],
  ["B6", "base: .ps1", R`/\.(exe|cmd|bat|ps1|com|js|mjs)$/i`, R`/\.(exe|cmd|bat|com|js|mjs)$/i`],
  ["B7", "base: .com", R`/\.(exe|cmd|bat|ps1|com|js|mjs)$/i`, R`/\.(exe|cmd|bat|ps1|js|mjs)$/i`],
  ["B8", "base: .js and .mjs", R`/\.(exe|cmd|bat|ps1|com|js|mjs)$/i`, R`/\.(exe|cmd|bat|ps1|com)$/i`],
  ["B9", "base: case", R`|com|js|mjs)$/i, "").toLowerCase();`, R`|com|js|mjs)$/i, "");`],
  ["B10", "a program in node_modules", R`/(^|\/)node_modules\//.test(`, R`/(^|\/)node_modules_x\//.test(`],
  ["B11", "the runtime rule (names)", R`if (RUNTIME.test(p.runner) ||`, R`if (false && RUNTIME.test(p.runner) ||`],
  ["B12", "the runtime rule judges the program started, not npx's package", R`if (RUNTIME.test(p.runner) ||`, R`if (RUNTIME.test(p.name) ||`],
  // program(): what comes before the program.
  ["P1", "assignments", R`(ASSIGN.test(ws[i]) || REDIRECT.test(ws[i]))`, R`(REDIRECT.test(ws[i]))`],
  ["P2", "redirections", R`(ASSIGN.test(ws[i]) || REDIRECT.test(ws[i]))`, R`(ASSIGN.test(ws[i]))`],
  ["P3", "PowerShell $v = command", R`if (!bash && /^\$[\w:.]+$/.test(`, R`if (false && /^\$[\w:.]+$/.test(`],
  ["P4", "all wrappers", R`const w = WRAPPERS.get(base(ws[i] ?? ""));`, R`const w = undefined;`],
  ["P5", "wrapper sudo", R`  sudo: { values:`, R`  sudo_: { values:`],
  ["P6", "wrapper sudo -u value", R`sudo: { values: ["-u", `, R`sudo: { values: [`],
  ["P7", "wrapper env", R`  env: { values:`, R`  env_: { values:`],
  ["P8", "wrapper env -S", R`split: ["-S", "--split-string"]`, R`split: []`],
  ["P9", "wrapper time", R`  time: { values:`, R`  time_: { values:`],
  ["P10", "wrapper exec", R`  exec: { values:`, R`  exec_: { values:`],
  ["P11", "wrapper nice", R`  nice: { values:`, R`  nice_: { values:`],
  ["P12", "wrapper nice -n value", R`nice: { values: ["-n", `, R`nice: { values: [`],
  ["P13", "wrapper nohup", R`  nohup: {},`, R`  nohup_: {},`],
  ["P14", "wrapper stdbuf", R`  stdbuf: { values:`, R`  stdbuf_: { values:`],
  ["P15", "wrapper timeout", R`  timeout: { values:`, R`  timeout_: { values:`],
  ["P16", "wrapper timeout's duration", R`before: 1 }`, R`before: 0 }`],
  ["P17", "wrapper timeout -s value", R`timeout: { values: ["-s", `, R`timeout: { values: [`],
  ["P18", "wrapper xargs", R`  xargs: { values:`, R`  xargs_: { values:`],
  ["P19", "wrapper xargs -n value", R`"-I", "-n", "-L"`, R`"-I", "-L"`],
  ["P20", "wrapper command", R`  command: { none:`, R`  command_: { none:`],
  ["P21", "command -v only looks", R`none: ["-v", "-V"]`, R`none: []`],
  ["P22", "wrapper builtin", R`  builtin: {},`, R`  builtin_: {},`],
  ["P23", "wrapper call", R`  call: {},`, R`  call_: {},`],
  ["P24", "wrapper wsl", R`  wsl: { values:`, R`  wsl_: { values:`],
  ["P26", "wrapper wsl -d value", R`wsl: { values: ["-d", `, R`wsl: { values: [`],
  ["P27", "wrapper wsl --cd value", R`"--user", "--cd", `, R`"--user", `],
  ["P29", "keyword if", R`  if: {}, then: {},`, R`  if_: {}, then: {},`],
  ["P30", "keyword then", R`then: {}, else: {}`, R`then_: {}, else: {}`],
  ["P31", "keyword else", R`else: {}, elif: {}`, R`else_: {}, elif: {}`],
  ["P32", "keyword elif", R`elif: {}, do: {}`, R`elif_: {}, do: {}`],
  ["P33", "keyword do", R`do: {}, while: {}`, R`do_: {}, while: {}`],
  ["P34", "keyword while", R`while: {}, until: {}`, R`while_: {}, until: {}`],
  ["P35", "keyword until", R`until: {}, "!": {}`, R`until_: {}, "!": {}`],
  ["P36", "keyword !", R`"!": {}, coproc: {}`, R`"!_": {}, coproc: {}`],
  ["P37", "keyword coproc", R`coproc: {},`, R`coproc_: {},`],
  ["P38", "npx's package", R`if (name === "npx" || name === "pnpx" || name === "bunx") {`, R`if (false) {`],
  ["P39", "node <path>/wrangler.js", R`} else if (name === "node" && args[0] &&`, R`} else if (false && args[0] &&`],
  // refuse(): starters, find, shells, evaluators, depth.
  ["S1", "Start-Process and start", R`if (STARTERS.has(name)) {`, R`if (false) {`],
  ["S2", "starter start-process", R`new Set(["start-process", "saps", "start"])`, R`new Set(["saps", "start"])`],
  ["S3", "starter saps", R`new Set(["start-process", "saps", "start"])`, R`new Set(["start-process", "start"])`],
  ["S4", "starter start", R`new Set(["start-process", "saps", "start"])`, R`new Set(["start-process", "saps"])`],
  ["S5", "Start-Process -FilePath", R`if ("filepath".startsWith(flag) || flag === "path" || flag === "pspath") file = value;`, R`if (false) file = value;`],
  ["S6", "Start-Process -ArgumentList", R`else if ("argumentlist".startsWith(flag) || flag === "args") list = value;`, R`else if (false) list = value;`],
  ["S7", "Start-Process -Verb takes a value", R`"redirectstandarderror", "verb", `, R`"redirectstandarderror", `],
  ["S8", "Start-Process switches take no value", R`if (inline === undefined) k--; // a switch`, R`// a switch`],
  ["S9", "cmd start /d takes a value", R`else if (file === undefined && !plain.length && /^\/(d|node|affinity)$/i.test(a)) k++;`, R`else if (false) k++;`],
  ["S10", "cmd start switches", R`(/^\/[A-Za-z]+$/.test(a) || a === "")) continue;`, R`(a === "")) continue;`],
  ["S11", "cmd start title", R`(/^\/[A-Za-z]+$/.test(a) || a === "")) continue;`, R`(/^\/[A-Za-z]+$/.test(a))) continue;`],
  ["S12", "starter's plain arguments", R`if (list === undefined && plain.length) list = plain.join(" ");`, R``],
  ["S13", "-ArgumentList's commas", R`...(list ?? "").split(",")`, R`...(list ?? "").split(";")`],
  ["S14", "find -exec", R`/^-(exec|execdir|ok|okdir)$/.test(a)`, R`/^-(execx)$/.test(a)`],
  ["S15", "PowerShell -EncodedCommand", R`/^[-/]e(c|n[a-z]*)?$/i.test(a)`, R`/^[-/]encodedcommand$/i.test(a)`],
  ["S16", "shell strings at all", R`if (SHELLS.has(name)) {
    const at = commandAt`, R`if (false) {
    const at = commandAt`],
  ["S17", "POSIX -c in a flag group", R`POSIX.has(name) ? /^-[A-Za-z]*c[A-Za-z]*$/ :`, R`POSIX.has(name) ? /^-c$/ :`],
  ["S18", "cmd //c", R`/^\/{1,2}[ck]$/i`, R`/^\/[ck]$/i`],
  ["S19", "pwsh -c abbreviation", R`/^[-/](c|co|com|comm|comma|comman|command|cwa|commandwithargs)$/i`, R`/^[-/](command)$/i`],
  ["S20", "shell string's words as a command", R`(refuse(rest, depth + 1) ?? check(rest.join(" "), depth + 1))`, R`(check(rest.join(" "), depth + 1))`],
  ["S21", "shell string as a command line", R`(refuse(rest, depth + 1) ?? check(rest.join(" "), depth + 1))`, R`(refuse(rest, depth + 1))`],
  ["S22", "shell string after --", R`(args[at + 1] === "--" ? 1 : 0)`, R`0`],
  ["S23", "shell cmd", R`new Set([...POSIX, "pwsh", "powershell", "cmd"])`, R`new Set([...POSIX, "pwsh", "powershell"])`],
  ["S24", "shell bash", R`new Set(["sh", "bash", "zsh"`, R`new Set(["sh", "zsh"`],
  ["S25", "shell powershell", R`new Set([...POSIX, "pwsh", "powershell", "cmd"])`, R`new Set([...POSIX, "pwsh", "cmd"])`],
  ["S26", "eval and iex run their string", R`const why = args.length ? check(args.join(" "), depth + 1) : undefined;`, R`const why = undefined;`],
  ["S27", "evaluator eval", R`new Set(["iex", "invoke-expression", "eval"])`, R`new Set(["iex", "invoke-expression"])`],
  ["S28", "evaluator iex", R`new Set(["iex", "invoke-expression", "eval"])`, R`new Set(["invoke-expression", "eval"])`],
  ["S29", "evaluator Invoke-Expression", R`new Set(["iex", "invoke-expression", "eval"])`, R`new Set(["iex", "eval"])`],
  ["S30", "too deep: the limit", R`const LIMIT = 4;`, R`const LIMIT = 40;`],
  ["S31", "too deep: refuse's check", R`function refuse(ws, depth = 0) {
  if (depth > LIMIT) return DEEP;`, R`function refuse(ws, depth = 0) {`],
  // check() and readsProgram(): what a shell reads from stdin.
  ["F1", "a shell's heredoc or here-string", R`const fed = [...stage.stdin, ...(before?.stdin ?? [])];`, R`const fed = [...(before?.stdin ?? [])];`],
  ["F2", "the heredoc of the stage before", R`const fed = [...stage.stdin, ...(before?.stdin ?? [])];`, R`const fed = [...stage.stdin];`],
  ["F3", "echo or printf before", R`if (before && ECHOES.has(program(before.words).name))`, R`if (false)`],
  ["F4", "a lone string before", R`else if (before?.words.length === 1) fed.push(before.words[0]);`, R``],
  ["F5", "echoes: printf", R`new Set(["echo", "printf", "write-output", "write"])`, R`new Set(["echo", "write-output", "write"])`],
  ["F6", "readsProgram: -s", R`(POSIX.has(name) && args.some((a) => /^-[A-Za-z]*s[A-Za-z]*$/.test(a)))`, R`false`],
  ["F7", "readsProgram: -", R`if (args.includes("-") ||`, R`if (`],
  ["F8", "readsProgram: evaluators", R`if (EVALS.has(name)) return true;`, R``],
  ["F9", "download piped into a shell", R`if (fetchAt >= 0 && `, R`if (false && `],
  // The reader: quotes, escapes, comments, here-strings, heredocs, groups and separators.
  ["L1", "single-quoted part joins its word", R`      add(src.slice(i + 1, stop));`, R`      endWord(); add(src.slice(i + 1, stop));`],
  ["L2", "double-quoted part joins its word", R`      add("");
      i = doubleQuoted(`, R`      endWord(); add("");
      i = doubleQuoted(`],
  ["L3", "an escape keeps only the character", R`      if (next !== "\n") add(next ?? "");`, R`      if (next !== "\n") add(c + (next ?? ""));`],
  ["L4", "backslash-newline joins lines", R`      if (next !== "\n") add(next ?? "");`, R`      add(next ?? "");`],
  ["L5", "comments", R`else if (c === "#" && word === null && (i === 0 || /[\s;&|]/.test(src[i - 1]))) {`, R`else if (false) {`],
  ["L6", "a comment starts only after a space or separator", R`(i === 0 || /[\s;&|]/.test(src[i - 1]))`, R`true`],
  ["L7", "PowerShell <# #> comments", R`} else if (!bash && c === "<" && next === "#") {`, R`} else if (false) {`],
  ["L8", "PowerShell here-strings", R`} else if (!bash && c === "@" &&`, R`} else if (false && c === "@" &&`],
  ["L9", "PowerShell @\"\"@ expands $( )", R`if (next === '"') expansions(body, out);`, R``],
  ["L10", "<<< here-string", R`} else if (bash && src.startsWith("<<<", i)) {`, R`} else if (false) {`],
  ["L11", "<<< word goes to stdin", R`(hereString ? stage.stdin : stage.words).push(word)`, R`stage.words.push(word)`],
  ["L12", "heredocs", R`} else if (bash && c === "<" && next === "<" && (m = HEREDOC.exec(src.slice(i)))) {`, R`} else if (false) {`],
  ["L13", "heredoc body goes to stdin", R`    h.stage.stdin.push(body);`, R``],
  ["L14", "unquoted heredoc expands $( )", R`    if (!h.literal) expansions(body, out);`, R``],
  ["L15", "quoted heredoc is literal, unquoted is not", R`pending.push({ stage, delim: m[2] ?? m[3] ?? m[4] ?? m[5], literal: m[5] === undefined,`, R`pending.push({ stage, delim: m[2] ?? m[3] ?? m[4] ?? m[5], literal: true,`],
  ["L16", "<<- strips tabs", R`literal: m[5] === undefined, strip: m[1] === "-" });
      i += m[0].length - 1;`, R`literal: m[5] === undefined, strip: false });
      i += m[0].length - 1;`],
  ["L17", "heredoc terminator", R`: line) === h.delim) break;`, R`: line) === h.delim + "x") break;`],
  ["L18", "$( ) inside double quotes", R`} else if (c === "$" && next === "(") {`, R`} else if (false) {`],
  ["L19", "bash double quotes keep a backslash before other characters", R`(!bash || `, R`(true || `],
  ["L20", "expansions' $( )", R`else if (text[i] === "$" && text[i + 1] === "(") i = scan(text, i + 2, ")", out);`, R``],
  ["L21", "&& and || end a pipeline", R`} else if ((c === "&" && next === "&") || (c === "|" && next === "|")) {`, R`} else if (false) {`],
  ["L22", "| starts a stage", R`} else if (c === "|") {
      endStage();`, R`} else if (c === "|") {
      add(c);`],
  ["L23", "|& is a pipe", R`      if (next === "&") i++;`, R``],
  ["L24", "; ends a command", R`} else if (c === ";") endPipeline();`, R`} else if (c === ";") add(c);`],
  ["L25", ">& and &> are redirections", R`if (/[<>]$/.test(word ?? "") || next === ">") add(c);`, R`if (false) add(c);`],
  ["L26", "& ends a command", R`      else endPipeline();
    } else if (c === "(" || c === "{") {`, R`      else add(c);
    } else if (c === "(" || c === "{") {`],
  ["L27", "( ) groups", R`} else if (c === "(" || c === "{") {`, R`} else if (c === "{") {`],
  ["L28", "{ } groups", R`} else if (c === "(" || c === "{") {`, R`} else if (c === "(") {`],
  ["L29", "a group's text stays in its word", R`      add(src.slice(i, end + 1));
      i = end;
    } else if (c === ")"`, R`      i = end;
    } else if (c === ")"`],
  ["L30", "a stray ) or } ends a command", R`} else if (c === ")" || c === "}") endPipeline();`, R`} else if (c === ")" || c === "}") add(c);`],
  ["L31", "a new line ends a command", R`    if (c === "\n") {
      endPipeline();`, R`    if (c === "\n") {
      endWord();`],
  ["L32", "PowerShell's escape is the backtick", 'const ESCAPE = bash ? "\\\\" : "`";', 'const ESCAPE = "\\\\";'],
  // Third-party repositories' files.
  ["T1", "Ludion-ai in any case", R`owner.toLowerCase() === "ludion-ai"`, R`owner === "ludion-ai"`],
  ["T2", "{owner} is the current repository", R` || /^(\{owner\}|:owner)$/i.test(owner)`, R``],
  ["T3", "endpoint contents", R`/^(contents|readme|tarball|zipball)`, R`/^(readme|tarball|zipball)`],
  ["T4", "endpoint readme", R`/^(contents|readme|tarball|zipball)`, R`/^(contents|tarball|zipball)`],
  ["T5", "endpoint tarball", R`/^(contents|readme|tarball|zipball)`, R`/^(contents|readme|zipball)`],
  ["T6", "endpoint zipball", R`/^(contents|readme|tarball|zipball)`, R`/^(contents|readme|tarball)`],
  ["T7", "endpoint compare", R`^(compare|git\/blobs)\/`, R`^(git\/blobs)\/`],
  ["T8", "endpoint git/blobs", R`^(compare|git\/blobs)\/`, R`^(compare)\/`],
  ["T9", "endpoint commits/<ref>", R`|^commits\/[^/]+$`, R``],
  ["T10", "endpoint pulls/<n>/files", R`|^pulls\/\d+\/files$`, R``],
  ["T11", "a diff, patch or raw header", R` || /diff|patch|raw|octet-stream/i.test(headers)`, R``],
  ["T12", "api.github.com URLs", R`/^(?:(?:https?:\/\/)?api\.github\.com)?\/?repos\/`, R`/^\/?repos\/`],
  ["T13", "raw.githubusercontent.com", R`raw\.githubusercontent\.com|codeload`, R`rawx\.githubusercontent\.com|codeload`],
  ["T14", "codeload.github.com", R`|codeload\.github\.com)`, R`|codeloadx\.github\.com)`],
  ["T15", "github.com raw, blob, archive, commit, compare", R`(?:raw|blob|archive|commit|compare)`, R`(?:none)`],
  ["T16", "github.com archive", R`(?:raw|blob|archive|commit|compare)`, R`(?:raw|blob|commit|compare)`],
  ["T17", "github.com pull diff, patch, files", R`\/pull\/\d+(?:\.diff|\.patch|\/files)$`, R`\/pullx\/\d+(?:\.diff|\.patch|\/files)$`],
  ["T18", "query string dropped", R`const url = target.replace(/[?#].*$/, "").replace(`, R`const url = target.replace(`],
  ["T19", "trailing / dropped", R`.replace(/\/+$/, "");
  const third`, R`;
  const third`],
  ["T20", "gh api --method takes a value", R`["-X", "--method", "-H",`, R`["-X", "-H",`],
  ["T21", "gh api -H is a header", R`if (args[k] === "-H" || args[k] === "--header") headers.push(args[k + 1] ?? "");`, R``],
  ["T22", "gh api's third-party files", R`return endpoint === undefined ? undefined : filesOwner(endpoint, headers.join(" "));`, R`return undefined;`],
  ["T23", "gh repo clone", R`if (name === "gh" && sub[0] === "repo" && sub[1] === "clone" && sub[2]) return repoOwner(sub[2]);`, R``],
  ["T24", "a github.com URL names its owner", R`github\.com[:/]([^/]+)\//i.exec(repo)`, R`githubx\.com[:/]([^/]+)\//i.exec(repo)`],
  ["T25", "gh pr diff, pr checkout, release download", R`if (name === "gh" && ((sub[0] === "pr" &&`, R`if (false && ((sub[0] === "pr" &&`],
  ["T26", "gh --repo", R`valueOf("-R", "--repo")`, R`valueOf("-R")`],
  ["T27", "gh pr diff <url>", R` ?? sub.slice(2).find((a) => /github\.com\//i.test(a))`, R``],
  ["T28", "git clone", R`if (args[k] !== "clone") return undefined;`, R`return undefined;`],
  ["T29", "git -C takes a value", R`["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(args[k]) ? 2 : 1`, R`1`],
  ["T30", "git clone --depth takes a value", R`"--separate-git-dir", "--depth", `, R`"--separate-git-dir", `],
  ["T31", "git clone from another host", R`return m ? (OURS(m[1]) ? undefined : m[1]) : url;`, R`return m ? (OURS(m[1]) ? undefined : m[1]) : undefined;`],
  ["T32", "git clone of a relative path is local", R` || !url.includes(":")) return undefined;`, R`) return undefined;`],
  ["T33", "git clone of a drive path is local", R`if (/^[A-Za-z]:[\\/]/.test(url) || `, R`if (`],
  ["T34", "downloads' third-party files", R`if (FETCHERS.has(name)) {
    const headers`, R`if (false) {
    const headers`],
  ["T35", "downloads' headers", R`/^(-H|--header|-headers?)$/i.test(args[k - 1] ?? "")`, R`false`],
  ["T36", "the third-party rule", R`if (owner) return THIRD_PARTY(owner);`, R`if (false) return THIRD_PARTY(owner);`],
  // The rules that were there before.
  ["E1", "wrangler deploy", R`if (deploys && !args.includes("--dry-run")) return`, R`if (false) return`],
  ["E2", "wrangler deploy --dry-run is fine", R`if (deploys && !args.includes("--dry-run")) return`, R`if (deploys) return`],
  ["E3", "wrangler secret", R`if (sub[0] === "secret" || (sub[0] === "versions" && sub[1] === "secret")) return`, R`if (false) return`],
  ["E4", "gh secret", R`if (name === "gh" && sub[0] === "secret") return`, R`if (false) return`],
  ["E5", "gh repo delete", R`if (name === "gh" && sub[0] === "repo" && sub[1] === "delete") return`, R`if (false) return`],
  ["E6", "force push", R`if (push.some((a) =>`, R`if (false && push.some((a) =>`],
  ["E7", "a download given to an evaluator", R`if (args.some((a) => [...FETCHERS].some((f) => a.toLowerCase().includes(f)))) return DOWNLOAD_RUN;`, R``],
  ["E8", "the backtick rule", R`const why = check(command) ?? (bash && runsBacktick(command) ? BACKTICK : undefined);`, R`const why = check(command);`],
  ["E9", "the message's Python example", R`const python = /^(python`, R`const python = /^(xpython`],
);

function runTests() {
  const r = spawnSync("npx", ["vitest", "run", ".claude/hooks/guard.test.ts", "--bail=1"], { cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } });
  const text = `${r.stdout}\n${r.stderr}`;
  const failed = /Tests\s+(\d+) failed/.exec(text)?.[1];
  const passed = /Tests\s+(?:\d+ failed \| )?(\d+) passed/.exec(text)?.[1];
  const first = /FAIL\s+(?:\|node\|\s+)?\.claude\/hooks\/guard\.test\.ts > (.+)/.exec(text)?.[1]?.trim() ?? "";
  return { status: r.status, failed: failed ? Number(failed) : 0, passed: passed ? Number(passed) : 0, first, tail: text.trim().split("\n").slice(-3).join(" | ") };
}

const lines = [];
const counts = { caught: 0, survived: 0, "not applied": 0, void: 0 };
try {
  const base = runTests();
  lines.push(`baseline\tstatus ${base.status}\tfailed ${base.failed}\tpassed ${base.passed}`);
  if (base.status !== 0 || base.failed !== 0) throw new Error(`the unchanged guard's tests do not pass: ${base.tail}`);
  for (const [id, rule, from, to] of M) {
    const at = original.split(from).length - 1;
    let result;
    if (at !== 1) result = { verdict: "not applied", note: `found ${at} times` };
    else {
      writeFileSync(target, original.split(from).join(to));
      const t = runTests();
      writeFileSync(target, original);
      if (t.failed > 0) result = { verdict: "caught", note: t.first };
      else if (t.status === 0) result = { verdict: "survived", note: `passed ${t.passed}` };
      else result = { verdict: "void", note: `status ${t.status}: ${t.tail}` };
    }
    counts[result.verdict]++;
    lines.push(`${id}\t${result.verdict}\t${rule}\t${result.note}`);
    process.stdout.write(`${id} ${result.verdict}\n`);
  }
} finally {
  writeFileSync(target, original);
}
lines.push(`total ${M.length}: caught ${counts.caught}, survived ${counts.survived}, not applied ${counts["not applied"]}, void ${counts.void}`);
writeFileSync(outFile, `${lines.join("\n")}\n`);
process.stdout.write(`${lines.at(-1)}\n`);
