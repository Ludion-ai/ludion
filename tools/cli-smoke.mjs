// Run against the extracted npm tarball on the declared minimum Node, not TypeScript or workspace imports.
// node tools/cli-smoke.mjs <extracted-package-folder>
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const folder = resolve(process.argv[2] ?? "packages/cli");
const pkg = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
assert.equal(pkg.engines.node, ">=22.19.0");
assert.equal(process.versions.node, "22.19.0", "Run this smoke test on the declared minimum Node 22.19.0");
const cli = join(folder, "dist/cli.js");
const root = mkdtempSync(join(tmpdir(), "ludion-tarball-smoke-"));
const project = join(root, "project");
mkdirSync(project);
writeFileSync(join(project, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/vitest": { version: "5.0.3" } } }));
const lesson = { id: "01M4N6JH8SHRYQE5CPY9SN1QQJ", format: 1, subject: "vitest", package: { ecosystem: "npm", name: "vitest" }, version: ">=5.0.0", claim: "vitest >=5.0.0 added `exampleOption`.", kind: "added", signal: "loud", teacher: "probe", verified_by: "source", verified_at: "2026-10-12T00:00:00Z", replaces: [] };
const server = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(req.url === "/index/subjects.json" ? { built_at: "test", subjects: { vitest: { lessons: 1 } }, inactive_ids: [] } : { built_at: "test", subject: "vitest", lessons: [lesson] }));
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const env = { ...process.env, LUDION_HOME: join(root, "home"), LUDION_SITE: `http://127.0.0.1:${server.address().port}` };
try {
  const help = await run(process.execPath, [cli, "--help"], { env, timeout: 15000 });
  assert.match(help.stdout, /ludion sync/);
  await run(process.execPath, [cli, "sync", "--dir", project], { env, timeout: 15000 });
  const md = readFileSync(join(project, ".ludion/lessons.md"), "utf8");
  assert.match(md, /exampleOption/);
  assert.match(md, /quote found/);
  assert.match(md, /They do not establish/);
  // Exercise the bundled source-check path without accessing a private address or running lesson code.
  const draft = { package: { ecosystem: "npm", name: "vitest" }, versions: ">=5.0.0", kind: "added", symbol: "exampleOption", signal: "loud", evidence: [{ source: { url: "https://localhost/", quote: "The exampleOption is available in the package configuration." } }] };
  const rejection = await run(process.execPath, [cli, "teach", "--draft", Buffer.from(JSON.stringify(draft)).toString("base64url")], { env, timeout: 15000 }).then(() => null, e => e);
  assert.equal(rejection?.code, 1);
  assert.match(rejection.stderr, /not a public domain name/);
  assert.match(rejection.stderr, /Not saved/);
  console.log(`Tarball smoke passed on Node ${process.versions.node}: help, online sync, evidence scope, guarded source-check refusal.`);
} finally { await new Promise(r => server.close(r)); }
