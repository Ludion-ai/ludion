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
  // Since LNODE4 detection goes through namesNodeImage.
  ["scan: FROM node not detected", `${S}scan.ts`, "namesNodeImage(textFile(root, imageFile))", "false"],
  ["init: node not offered", `${S}cli.ts`, "namesNodeImage(textFile(root, \"Dockerfile\"))) choices.push(\"node\")", "false) choices.push(\"node\")"],
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
  // The four the R lane's review 6532823264 found surviving (M1, M9, D2, H1), added after it.
  ["M1: the index request follows redirects", `${S}php.ts`, "fetchFn(url, { redirect: \"error\",", "fetchFn(url, { redirect: \"follow\","],
  ["M9: the index deadline 300 s", `${S}node.ts`, "\"Node.js release\", 4, 30_000", "\"Node.js release\", 4, 300_000"],
  ["D2: the PR job takes the same version", `${S}deliver.ts`, "compare(to, current.version) <= 0", "compare(to, current.version) < 0"],
  ["H1: PHP's hyphen check removed", `${S}php.ts`, "if (!image.flavor.startsWith(\"-\")) throw", "if (false) throw"],
  // LNODE3, after R231c's review 6534443349: which FROM lines an unconfigured scan and init take for a node image.
  ["N1: detection back to the three forms of a4ee125", `${S}node.ts`, String.raw`/^[ \t]*FROM[ \t]+(?:--\S+[ \t]+)*(?:\S*\/)?node(?=[:@ \t\r]|$)/im`, String.raw`/^\s*FROM\s+(?:(?:docker\.io\/)?library\/)?node:/im`],
  ["N2: no --flag before the image", `${S}node.ts`, String.raw`FROM[ \t]+(?:--\S+[ \t]+)*(?:\S*\/)?node`, String.raw`FROM[ \t]+(?:\S*\/)?node`],
  ["N3: no registry or namespace prefix", `${S}node.ts`, String.raw`(?:--\S+[ \t]+)*(?:\S*\/)?node(`, String.raw`(?:--\S+[ \t]+)*node(`],
  ["N4: only node: (no digest, no bare node)", `${S}node.ts`, String.raw`node(?=[:@ \t\r]|$)/im`, String.raw`node(?=:)/im`],
  ["N5: any name starting with node", `${S}node.ts`, String.raw`node(?=[:@ \t\r]|$)/im`, String.raw`node/im`],
  ["N6: not anchored on FROM", `${S}node.ts`, String.raw`/^[ \t]*FROM[ \t]+(?:--\S+`, String.raw`/(?:--\S+`],
  ["N7: case-sensitive", `${S}node.ts`, String.raw`|$)/im;`, String.raw`|$)/m;`],
  // LNODE4, after R231d's review 6535222762: a leading byte-order mark, and R231d's surviving R2, R4 and R5.
  ["B1: detection reads the byte-order mark", `${S}node.ts`, "NODE_FROM.test(withoutBom(dockerfile))", "NODE_FROM.test(dockerfile)"],
  ["B2: withoutBom removes nothing", `${S}php.ts`, String.raw`text.startsWith("\u{FEFF}") ? text.slice(1) : text`, "text"],
  ["B3: the image's offsets leave out the mark", `${S}php.ts`, "const start = mark + stage.index!", "const start = stage.index!"],
  ["B4 (equivalent: \\s matches U+FEFF): reading keeps the mark", `${S}php.ts`, "const dockerfile = withoutBom(file), mark = file.length - dockerfile.length;", "const dockerfile = file, mark = 0;"],
  ["R2: any pin after @", `${S}node.ts`, "(?:@sha256:[a-f0-9]{64})?$/,", "(?:@[^ ]+)?$/,"],
  ["R4: a PHP policy takes a receipt that says node", `${S}deliver.ts`, "if (scanned !== (runtime === \"node\" ? \"node\" : undefined)) refuse", "if (runtime === \"node\" && scanned !== \"node\") refuse"],
  ["R5: a saved node policy does not force the node check", `${S}scan.ts`, "(auto && saved && \"dockerfile\" in saved && saved.ecosystem === \"node\") || ", ""],
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
