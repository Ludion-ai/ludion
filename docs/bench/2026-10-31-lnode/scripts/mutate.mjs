// Mutations of LNODE's code, each run against the tests that should catch it (in Docker, no network, in /w).
// Each mutation replaces one exact text that must occur once; the file is restored after each run, and at the end
// every file is compared with the worktree's copy at /src. Usage: node mutate.mjs (from scripts/mutate.sh).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const S = "packages/cli/src/security/";
const TESTS = ["packages/cli/test/node-image.test.ts", "packages/cli/test/deliver.test.ts", "packages/cli/test/security.test.ts"];
const M = [
  ["candidate: the smallest security release, not the newest", `${S}node.ts`, "const fixed = fixes[0];", "const fixed = fixes[fixes.length - 1];"],
  ["candidate: the newest release, security or not", `${S}node.ts`, "const fixed = fixes[0];", "const fixed = fixes.length ? releases[0] : undefined;"],
  ["the security mark ignored", `${S}node.ts`, "releases.filter(r => r.security && compare", "releases.filter(r => compare"],
  ["other lines counted", `${S}node.ts`, "if (!match || match[1] !== line) continue;", "if (!match) continue;"],
  ["a date that is not a real day accepted", `${S}node.ts`, "!realDay(item.date) || ", ""],
  ["a version listed twice accepted", `${S}node.ts`, "if (releases.some(r => r.version === version)) throw", "if (false) throw"],
  ["floating tags read as versions", `${S}node.ts`, "node:(\\d+\\.\\d+\\.\\d+)(", "node:(\\d+(?:\\.\\d+){0,2})("],
  ["any repository named node", `${S}node.ts`, "/^(?:(?:docker\\.io\\/)?library\\/)?node:", "/^(?:[a-z.]+\\/)*node:"],
  ["index size limit raised", `${S}node.ts`, "\"Node.js release\", 4, 30_000", "\"Node.js release\", 64, 30_000"],
  ["probe without the v", `${S}patch.ts`, "process.version === 'v${version}'", "process.version === '${version}'"],
  ["digest of any repository taken", `${S}patch.ts`, "library/)?${repository}@sha256", "library/)?[a-z]+@sha256"],
  ["branch named php for node", `${S}patch.ts`, "...(base.prefix ? [base.prefix] : []), repository, scan.candidate.version", "...(base.prefix ? [base.prefix] : []), \"php\", scan.candidate.version"],
  ["node policy run as PHP", `${S}patch.ts`, "config.ecosystem === \"node\" ? \"node\" : \"php\"", "\"php\" as \"php\" | \"node\""],
  ["fix published: the newest security release", `${S}exposure.ts`, "const first = [...scan.security_releases].sort((a, b) => compare(a.version, b.version))[0];\n  if (!first) return { at: null, note: \"Not found: nodejs.org", "const first = [...scan.security_releases].sort((a, b) => compare(b.version, a.version))[0];\n  if (!first) return { at: null, note: \"Not found: nodejs.org"],
  ["scan: FROM node not detected", `${S}scan.ts`, "NODE_FROM.test(textFile(root, imageFile))", "false"],
  ["init: node not offered", `${S}cli.ts`, "NODE_FROM.test(textFile(root, \"Dockerfile\"))) choices.push(\"node\")", "false) choices.push(\"node\")"],
  ["PR job: receipt runtime not checked", `${S}deliver.ts`, "if (scanned !== (runtime === \"node\" ? \"node\" : undefined)) refuse", "if (false) refuse"],
  ["PR job: node policy read as PHP", `${S}deliver.ts`, "ecosystem: config.ecosystem === \"node\" ? \"node\" : \"php\", dockerfile", "ecosystem: \"php\" as Ecosystem, dockerfile"],
  ["PR job: Dockerfile + other ecosystem accepted", `${S}deliver.ts`, "&& config.ecosystem !== \"node\") refuse(", "&& config.ecosystem !== \"node\" && false) refuse("],
  ["PR job: any repository in the new FROM", `${S}deliver.ts`, "library/)?${ecosystem}:${escape(to)}", "library/)?[a-z]+:${escape(to)}"],
  ["PR job: another major accepted", `${S}deliver.ts`, "!to.startsWith(`${current.branch}.`) || ", ""],
  ["PR job: digest not compared", `${S}deliver.ts`, "return listed === match[2] ? null :", "return listed === listed ? null :"],
  ["PR job: PHP's digest asked for node", `${S}deliver.ts`, "given = repository === \"node\" ? options.nodeDigest : options.phpDigest", "given = options.phpDigest"],
  ["PR job: Docker Hub asked for library/php", `${S}deliver.ts`, "scope=repository:library/${repository}:pull", "scope=repository:library/php:pull"],
  ["PR job: Docker Hub manifest of library/php", `${S}deliver.ts`, "v2/library/${repository}/manifests/", "v2/library/php/manifests/"],
  ["PR body: no Node.js advisory note", `${S}deliver.ts`, "ecosystem === \"node\" ? \"nodejs.org's security release (no advisory ID read)\" : ", ""],
];

const results = [];
for (const [name, file, from, to] of M) {
  const original = readFileSync(`/w/${file}`, "utf8"), count = original.split(from).length - 1;
  if (count !== 1) { results.push(`NOT APPLIED (${count} matches)  ${name}`); continue; }
  writeFileSync(`/w/${file}`, original.split(from).join(to));
  try {
    const run = spawnSync("npx", ["vitest", "run", "--project", "node", "--maxWorkers=2", ...TESTS], { cwd: "/w", encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }, timeout: 300_000 });
    const failed = (run.stdout.match(/Tests\s+(\d+) failed/) ?? [])[1];
    results.push(`${run.status === 0 ? "SURVIVED" : `caught (${failed ?? "?"} failed, exit ${run.status})`}  ${name}`);
  } finally { writeFileSync(`/w/${file}`, original); }
}
for (const line of results) console.log(line);
console.log(`${results.filter(r => r.startsWith("caught")).length} of ${M.length} caught; ${results.filter(r => r.startsWith("SURVIVED")).length} survived; ${results.filter(r => r.startsWith("NOT")).length} not applied`);
const changed = [...new Set(M.map(m => m[1]))].filter(f => readFileSync(`/w/${f}`, "utf8") !== readFileSync(`/src/${f}`, "utf8"));
console.log(changed.length ? `RESTORE FAILED: ${changed.join(", ")}` : "every mutated file is again the worktree's");
