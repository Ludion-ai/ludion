// PreToolUse hook for Bash and PowerShell: refuses commands that change production or secrets, or that run a
// downloaded script. settings.json denies the plain forms; this sees the whole command line and judges each command
// in it by what it runs, not by words that merely appear (a commit message or a grep pattern that mentions a deploy
// is fine). `wrangler deploy --dry-run` passes: a deny rule can't make that exception. Exit 2 blocks the call.
let input = "";
for await (const chunk of process.stdin) input += chunk;
const command = String(JSON.parse(input || "{}").tool_input?.command ?? "");

/** Words of one command, quotes respected: a quoted string is one word, without its quotes. */
function words(segment) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (let m = re.exec(segment); m; m = re.exec(segment)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Split a command line at ; && || & and newlines (outside quotes) into pipelines, and each pipeline at | into stages. */
function pipelines(line) {
  const result = [[]];
  let current = "";
  let quote = null;
  const pushStage = () => {
    result.at(-1).push(current.trim());
    current = "";
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote && line[i - 1] !== "\\") quote = null;
      current += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      current += c;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      pushStage();
      result.push([]);
      i++;
      continue;
    }
    if (c === ";" || c === "\n" || c === "&") {
      pushStage();
      result.push([]);
      continue;
    }
    if (c === "|") {
      pushStage();
      continue;
    }
    current += c;
  }
  pushStage();
  return result.map((p) => p.filter(Boolean)).filter((p) => p.length);
}

/** The program a command runs and its arguments, seeing through env assignments, sudo, npx, and node <path>/wrangler.js. */
function program(ws) {
  let i = 0;
  while (i < ws.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[i]) || ws[i] === "sudo" || ws[i] === "&")) i++;
  let name = (ws[i] ?? "").replace(/\\/g, "/").split("/").pop().replace(/\.(exe|cmd|js|mjs)$/i, "").toLowerCase();
  let args = ws.slice(i + 1);
  if (name === "npx" || name === "pnpx" || name === "bunx") {
    const rest = args.filter((a) => !a.startsWith("-"));
    name = (rest[0] ?? "").toLowerCase();
    args = args.slice(args.indexOf(rest[0]) + 1);
  } else if (name === "node" && args[0] && /wrangler(\.js)?$/i.test(args[0].replace(/\\/g, "/"))) {
    name = "wrangler";
    args = args.slice(1);
  }
  return { name, args };
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "pwsh", "powershell", "cmd"]);
const FETCHERS = new Set(["curl", "wget", "iwr", "irm", "invoke-webrequest", "invoke-restmethod"]);
const EVALS = new Set(["iex", "invoke-expression"]);

/** Why one command is refused, or undefined. */
function refuse(ws, depth = 0) {
  const { name, args } = program(ws);
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
  if (EVALS.has(name) && args.some((a) => [...FETCHERS].some((f) => a.toLowerCase().includes(f)))) {
    return "Running a downloaded script runs code nobody read. Download it, read it, then decide.";
  }
  // A shell given a command string: judge the string as a command line of its own.
  if (SHELLS.has(name) && depth < 3) {
    const flag = args.findIndex((a) => /^(-c|-command|\/c|\/k)$/i.test(a));
    if (flag >= 0 && args[flag + 1]) return check(args.slice(flag + 1).join(" "), depth + 1);
  }
  return undefined;
}

function check(line, depth = 0) {
  for (const stages of pipelines(line)) {
    const parsed = stages.map(words);
    for (const ws of parsed) {
      const why = refuse(ws, depth);
      if (why) return why;
    }
    // A download piped into something that runs its input as a program: a shell or interpreter reading its program
    // from stdin (no -c, -e, or script file), or an evaluator.
    const runsStdin = (ws) => {
      const { name, args } = program(ws);
      if (EVALS.has(name)) return true;
      const interpreter = SHELLS.has(name) || ["node", "python", "python3", "perl", "ruby"].includes(name);
      if (!interpreter) return false;
      if (args.some((a) => /^(-c|-e|-p|--eval|--print|-command|\/c)$/i.test(a))) return false;
      return !args.some((a) => !a.startsWith("-"));
    };
    const fetchAt = parsed.findIndex((ws) => FETCHERS.has(program(ws).name));
    if (fetchAt >= 0 && parsed.slice(fetchAt + 1).some(runsStdin)) {
      return "Piping a download into a shell runs code nobody read. Download it, read it, then decide.";
    }
  }
  return undefined;
}

const why = check(command);
if (why) {
  process.stderr.write(`Blocked by .claude/hooks/guard.mjs: ${why}\n`);
  process.exit(2);
}
