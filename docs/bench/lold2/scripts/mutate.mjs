// LOLD2: each check is broken in turn in the copy at /vol/app, and the tests must fail. Docker only, with no network.
// Usage: node mutate.mjs <out.json>
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const O = "packages/cli/src/security/oldest.ts", D = "packages/cli/src/security/dependency-patch.ts", L = "packages/cli/src/security/deliver.ts";
const OLD = "packages/cli/test/oldest.test.ts", DEP = "packages/cli/test/dependencies.test.ts", DEL = "packages/cli/test/deliver.test.ts";
const MUTATIONS = [
  ["newest first instead of oldest", O, "usable.sort(oldestFirst);", "usable.sort(oldestFirst).reverse();", [OLD]],
  ["lowest version instead of earliest published", O, "const oldestFirst = (a: string, b: string) => (at(a) - at(b)) || semver.compare(a, b, { loose: true });", "const oldestFirst = (a: string, b: string) => semver.compare(a, b, { loose: true });", [OLD]],
  ["versions after T are taken", O, "rest.filter(version => at(version) <= t)", "rest", [OLD]],
  ["deprecated versions are taken", O, 'else if (typeof doc.versions[version].deprecated === "string" && doc.versions[version].deprecated) pass(version, "deprecated", `deprecated: ${plain(doc.versions[version].deprecated)}`);', "", [OLD]],
  ["withdrawn versions are not told apart", O, 'else if (!isObject(doc.versions[version])) pass(version, "withdrawn", "no longer listed by the registry");', "", [OLD]],
  ["OSV's records are ignored", O, 'if (ids.length) pass(version, "advisory", `OSV names it in ${ids.slice(0, 5).join(", ")}`);\n          else if (await accept(version)) return version;', "if (await accept(version)) return version;", [OLD]],
  ["a withdrawn OSV record counts", O, "if (!(await records.advisory(id)).withdrawn) live.push(id);", "live.push(id);", [OLD]],
  ["nothing left: the newest in range is taken", O, 'return { ...none(`nothing is left in range:', 'if (all.length) return of([...all].sort((a, b) => semver.compare(b, a, { loose: true }))[0]!, "oldest", passed);\n    return { ...none(`nothing is left in range:', [OLD]],
  ["locked versions do not come first", O, "const lockedHere = usable.filter(version => locked.get(name)?.has(version));", "const lockedHere: string[] = [];", [OLD]],
  ["V does not answer its own range", O, 'if (v) return of(v, "v", []);', "", [OLD]],
  ["anything after T counts as the same release", O, "return !!other && fixes.some(f => sameRelease({ version: f.version, published: f.published, identity: f.identity! }, { version, published: at(version), identity: other }, t));", "return true;", [OLD]],
  ["optional peers are required", O, 'if (group === "peerDependencies" && Object.hasOwn(meta, name) && meta[name]?.optional === true) continue;\n      const requirement', "const requirement", [OLD]],
  ["answers' own requirements are not walked", O, "if (isObject(manifest)) for (const requirement of requirementsOf(manifest)) add(requirement);", "", [OLD, DEP]],
  ["T ignores the advisory", O, "const t = advisory === null ? v : Math.max(v, advisory);", "const t = v;", [OLD]],
  ["T takes the latest advisory", O, "const advisory = seen.length ? Math.min(...seen) : null;", "const advisory = seen.length ? Math.max(...seen) : null;", [OLD]],
  ["the age of a version is not checked", O, "if (at + wait > pushed) waits.push(", "if (false) waits.push(", [OLD, DEP]],
  ["the oldest version sets the line", O, "if (!youngest || at > youngest.at) youngest = { id, at };", "if (!youngest || at < youngest.at) youngest = { id, at };", [OLD, DEP]],
  ["a version the table did not give passes", O, 'if (role === null) problems.push(`${id} at ${c.path} is not a version the table of oldest versions gave for ${c.name}.`);', "", [OLD, DEP]],
  ["a version after T passes the assert", O, 'if (role === "oldest" && at > t) problems.push(', "if (false) problems.push(", [OLD]],
  ["no publish time passes the assert", O, "problems.push(`${id} at ${c.path} has no publish time, so its age cannot be checked.`); continue;", "continue;", [OLD]],
  ["the resolution time is T alone", O, "const resolved = Math.min(t, pushed - wait);", "const resolved = t;", [OLD]],
  ["a move needs no reason", O, "if (!loaders(is, after, path).some(loader => takes(loader.spec, name, from) === false)) problems.push(move);", "", [OLD, DEL]],
  ["a loader that cannot be read counts as a reason", O, "takes(loader.spec, name, from) === false)", "takes(loader.spec, name, from) !== true)", [OLD]],
  ["a removal needs no reason", O, "if (!had.length || had.some(({ at }) => at === \"\" || after.get(at)?.version === was[at]?.version)) problems.push(move);", "", [OLD, DEP]],
  ["another package at the path is a move", O, "if (now && packageAt(path, now) !== name) { problems.push(move); continue; }", "", [OLD]],
  ["the script gives a question with no answer to npm", O, 'if (typeof version !== "string") throw Object.assign(', 'if (typeof version !== "string") return manifest(spec, opts);\n  if (false) throw Object.assign(', [OLD]],
  ["a stop is not counted", O, 'return { stopped_no_allowed: true, reason: `No allowed version for', 'return { stopped_no_allowed: false, reason: `No allowed version for', [OLD, DEP]],
  ["patch does not stop on the landing assert", D, "if (landing.length) throw new Error(", "if (false) throw new Error(", [DEP]],
  ["patch does not stop on the age assert", D, "if (assert.waits.length) throw new Error(", "if (false) throw new Error(", [DEP]],
  ["patch does not check moves", D, 'unneededMoves(textFile(source, "package-lock.json"), textFile(candidate.exported, "package-lock.json"), fix.changes).map(m => `${m.name}@${m.from}`)', "[]", [DEP]],
  ["patch gives npm no table", D, "if (plan && table) {", "if (false) {", [DEP]],
  ["npm's own install runs in place of the table's", D, 'text += run(["node", RESOLVER_SCRIPT]);\n      text += run(["cp", NPM_FINAL_MANIFEST, "package.json"]);', 'text += run(["npm", "install", "--package-lock-only", ...npmFlags]);\n      text += run(["cp", NPM_FINAL_MANIFEST, "package.json"]);', [DEP]],
  ["a failure's reason is not read from npm's error", D, "if (!key) throw error;", "throw error;", [DEP]],
  ["the PR job does not check moves", L, "if (unneeded.length) return", "if (false) return", [DEL]],
  ["the PR job takes moves nothing reaches", L, "if (strayMoves.length) return", "if (false) return", [DEL]],
  ["the PR job takes any other change as a move", L, 'if (kinds.get(path) !== "install" || before.link || after.link || before.version === after.version) return', "if (false) return", [DEL]],
];
const results = [];
for (const [what, file, from, to, tests] of MUTATIONS) {
  const original = readFileSync(file, "utf8");
  if (original.split(from).length !== 2) { results.push({ what, file, caught: null, note: "the text to change is not there once" }); console.log(JSON.stringify(results.at(-1))); continue; }
  writeFileSync(file, original.replace(from, () => to));
  const run = spawnSync("npx", ["vitest", "run", "--bail", "1", ...tests], { encoding: "utf8", timeout: 240_000, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(file, original);
  const failed = /FAIL\s.*?> (.*)/.exec((run.stdout + run.stderr).replace(/\x1b\[[0-9;]*m/g, ""))?.[1]?.slice(0, 140) ?? null;
  results.push({ what, file: file.split("/").at(-1), caught: run.status !== 0, by: failed });
  console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(process.argv[2], `${JSON.stringify({ total: results.length, caught: results.filter(r => r.caught).length, results }, null, 2)}\n`);
console.log(`caught ${results.filter(r => r.caught).length} of ${results.length}`);
