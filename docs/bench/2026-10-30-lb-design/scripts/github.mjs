// A stand-in for the parts of GitHub's REST API that `ludion deliver open` calls: the repository's default branch, the
// PRs from a branch, a branch's commit (read from the bare origin) and opening a PR. PRs are kept in a JSON file, so
// a later run sees the PRs of an earlier one. Usage: node github.mjs <state.json> <origin.git> <port>
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const [state, origin, port] = process.argv.slice(2);
const load = () => existsSync(state) ? JSON.parse(readFileSync(state, "utf8")) : { pulls: [], calls: [] };
createServer((req, res) => {
  let raw = "";
  req.on("data", chunk => { raw += chunk; });
  req.on("end", () => {
    const s = load(), u = new URL(req.url, "http://x"), reply = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    s.calls.push(`${req.method} ${u.pathname}${u.search}`);
    try {
      if (req.headers.authorization !== "Bearer e2e-token") return reply(401, { message: "Bad credentials" });
      if (u.pathname === "/repos/o/r") return reply(200, { default_branch: "main" });
      if (u.pathname === "/repos/o/r/pulls" && req.method === "GET") return reply(200, s.pulls.filter(p => `o:${p.head.ref}` === u.searchParams.get("head")));
      if (u.pathname.startsWith("/repos/o/r/git/ref/heads/")) {
        const branch = decodeURIComponent(u.pathname.slice("/repos/o/r/git/ref/heads/".length));
        const r = spawnSync("git", ["--git-dir", origin, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { encoding: "utf8" });
        return r.status === 0 ? reply(200, { ref: `refs/heads/${branch}`, object: { sha: r.stdout.trim() } }) : reply(404, { message: "Not Found" });
      }
      if (u.pathname === "/repos/o/r/pulls" && req.method === "POST") {
        const body = JSON.parse(raw), number = s.pulls.length + 1;
        s.pulls.push({ number, state: "open", head: { ref: body.head }, base: { ref: body.base }, title: body.title, body: body.body });
        return reply(201, { number, html_url: `https://github.invalid/o/r/pull/${number}` });
      }
      return reply(404, { message: "Not Found" });
    } finally { writeFileSync(state, JSON.stringify(s, null, 2)); }
  });
}).listen(Number(port), "127.0.0.1");
