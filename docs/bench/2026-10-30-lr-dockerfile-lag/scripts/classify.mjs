// LR/LR2: reads third-party file contents inside Docker and prints only flags and matched lines
// (decisions 2026-10-30-lr-dockerfile-lag-definitions and 2026-10-31-lr2-definitions, sections 2–4).
// Runs with no network, a read-only root and no host environment. Input on stdin, one file per line:
//   <id>\t<kind>\t<encoding>\t<base64 content>
// kinds: from:<php|node> (a hit Dockerfile in the walk), measured (the measured Dockerfile),
//        package.json, composer.json, dependabot, workflow
// Output: tab-separated lines, starting with the input's id. Nothing is written to disk.
import { createInterface } from "node:readline";
import { phpImage } from "/p/php.ts";

const clean = (s) => s.replace(/[\t\r\n]/g, " ").slice(0, 200);
// A FROM line keeps its full text (LR section 7 logs the matched FROM lines).
const out = (...cols) => process.stdout.write(cols.map(String).join("\t") + "\n");

// LR section 2: FROM [--platform=x] [prefix]<image>:X.Y.Z[-variant][@sha256:<64 hex>] [AS name]
const qualifies = (image) => new RegExp(
  "^\\s*[Ff][Rr][Oo][Mm]\\s+(--platform=\\S+\\s+)?(docker\\.io/library/|index\\.docker\\.io/library/|docker\\.io/|library/)?" +
  image + ":[0-9]+\\.[0-9]+\\.[0-9]+(-[A-Za-z0-9._-]+)?(@sha256:[0-9a-f]{64})?(\\s+[Aa][Ss]\\s+\\S+)?\\s*$");
const FROM_LINE = /^\s*[Ff][Rr][Oo][Mm]\s/;

// LR2 section 3: instructions are lines without comments, continuations joined.
const instructions = (text) => {
  const res = [];
  let cur = null;
  for (const line of text.split("\n")) {
    if (/^\s*#/.test(line)) continue;
    const cont = /\\[ \t]*$/.test(line);
    const part = cont ? line.replace(/\\[ \t]*$/, "") : line;
    cur = cur === null ? part : `${cur} ${part}`;
    if (!cont) { res.push(cur); cur = null; }
  }
  if (cur !== null) res.push(cur);
  return res;
};

// LR2 section 3.2, in the decision's order
const NETWORK = [
  /\bapt-get\s+(install|update|upgrade|dist-upgrade)\b/i, /\bapt\s+(install|update|upgrade)\b/i, /\bapk\s+(add|update|upgrade)\b/i,
  /\b(yum|dnf|microdnf)\s+(install|update|upgrade|makecache)\b/i, /\bzypper\s+(in|install|ref|refresh|up|update)\b/i,
  /\b(pecl|pear)\s+install\b/i, /\binstall-php-extensions\b/i,
  /\b(curl|wget)\b/i, /\bgit\s+(clone|fetch|pull|submodule)\b/i,
  /\bcomposer\s+(install|update|require|create-project|global)\b/i,
  /\bnpm\s+(install|i|ci|add|update|install-[a-z-]+)\b/i, /\bnpx\b/i, /\bpnpm\s+(install|i|add|fetch|dlx)\b/i,
  /\byarn(\s+(install|add|dlx)\b|\s*(&&|;|\||$))/i, /\bbunx?\b(\s+(install|i|add)\b)?/i, /\bcorepack\s+(prepare|install)\b/i,
  /\bpip3?\s+install\b/i, /\bgem\s+install\b/i, /\bbundle\s+install\b/i, /\bgo\s+(get|install|mod\s+download)\b/i,
];

const measured = (id, text) => {
  let php = "accepted";
  try { phpImage(text); } catch (e) { php = `refused: ${clean(e.message)}`; }
  const ins = instructions(text);
  let offline = "yes", why = "";
  for (const i of ins) {
    if (/^\s*RUN\b/i.test(i)) {
      const k = NETWORK.findIndex((re) => re.test(i));
      if (k >= 0) { offline = "no"; why = `RUN pattern ${k + 1}: ${clean(i.trim())}`; break; }
    } else if (/^\s*ADD\s/i.test(i) && /https?:\/\/|git@/i.test(i)) {
      offline = "no"; why = `ADD: ${clean(i.trim())}`; break;
    }
  }
  const expose = ins.some((i) => /^\s*EXPOSE\s+\S/i.test(i)) ? "yes" : "no";
  const health = ins.some((i) => /^\s*HEALTHCHECK\s+/i.test(i) && !/^\s*HEALTHCHECK\s+NONE\b/i.test(i)) ? "yes" : "no";
  out(id, "measured", php, offline, why, expose, health);
};

const testScript = (id, kind, text) => {
  // LR section 5: the root package.json's "renovate" key, by line, whether or not the file parses
  const renovate = kind === "package.json" && text.split("\n").some((l) => /^\s*"renovate"\s*:/.test(l)) ? "yes" : "no";
  let j;
  try { j = JSON.parse(text); } catch { return out(id, kind, "unknown", renovate, "does not parse"); }
  const t = j && typeof j === "object" ? j.scripts?.test : undefined;
  let yes = false;
  if (typeof t === "string") yes = t.trim().length > 0 && !(kind === "package.json" && t.includes("no test specified"));
  else if (kind === "composer.json" && Array.isArray(t)) yes = t.length > 0;
  out(id, kind, yes ? "yes" : "no", renovate, typeof t === "string" ? clean(t) : t === undefined ? "" : clean(JSON.stringify(t)));
};

const PUSH = [
  /^\s*["']?on["']?\s*:\s*["']?push["']?\s*(#.*)?$/, /^\s*["']?on["']?\s*:\s*\[[^\]]*\bpush\b/,
  /^\s+["']?push["']?\s*:\s*(\{\s*\}|null|~)?\s*(#.*)?$/, /^\s*-\s*["']?push["']?\s*(#.*)?$/,
];
const workflow = (id, text) => {
  const lines = text.split("\n").filter((l) => !/^\s*#/.test(l));
  const push = lines.some((l) => PUSH.some((re) => re.test(l))) ? "yes" : "no";
  const deploy = lines.some((l) => /deploy/i.test(l)) ? "yes" : "no";
  out(id, "workflow", push, deploy);
};

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const [id, kind, encoding, b64 = ""] = line.split("\t");
  if (encoding !== "base64") { out(id, kind, "unreadable", `encoding ${clean(encoding ?? "")}`); continue; }
  const text = Buffer.from(b64, "base64").toString("utf8").replace(/\r/g, "");
  if (kind.startsWith("from:")) {
    const re = qualifies(kind.slice(5));
    let last = "";
    text.split("\n").forEach((l, n) => {
      if (!FROM_LINE.test(l)) return;
      out(id, "FROM", n + 1, l.replace(/\t/g, " "));
      if (re.test(l)) last = l;
    });
    out(id, "QUAL", last.replace(/\t/g, " "));
  } else if (kind === "measured") measured(id, text);
  else if (kind === "package.json" || kind === "composer.json") testScript(id, kind, text);
  else if (kind === "dependabot") {
    const m = text.split("\n").find((l) => /package-ecosystem:\s*["']?docker["']?\s*(#.*)?$/i.test(l));
    out(id, "dependabot", m ? "yes" : "no", m ? clean(m.trim()) : "");
  } else if (kind === "workflow") workflow(id, text);
  else out(id, kind, "unknown-kind");
}
