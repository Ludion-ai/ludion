// Each mutation undoes one part of LV in /w; the CLI's dependency tests must fail on every one and pass without them.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const PATCH = "packages/cli/src/security/dependency-patch.ts", NEXT = "packages/cli/src/security/next-fix.ts", FACTS = "packages/cli/src/security/npm-facts.ts";
const mutations = [
  ["the check runs for every ecosystem", PATCH, `if (ecosystem === "npm") for (const fix of receipt.fixes) {`, `for (const fix of receipt.fixes) {`],
  ["the check is never made", PATCH, `try { choice = await nextFix(fix.package, to, deps.fetchFn); }`, `try { choice = null; }`],
  ["the version taken is not used", PATCH, `if (taken.size) fix.changes =`, `if (false) fix.changes =`],
  ["a failed check fails the fix", PATCH, `catch (error) { choice = { package: fix.package,`, `catch (error) { throw error; choice = { package: fix.package,`],
  ["the plan's own changes are changed in place", PATCH, `fix.changes = fix.changes.map(c => taken.has(c.to) ? { ...c, to: taken.get(c.to)! } : c);`, `for (const c of fix.changes) if (taken.has(c.to)) c.to = taken.get(c.to)!;`],
  ["the publish-time note is not marked", PATCH, `if (fix.version_choice?.some(c => c.chosen)) fix.fix_published_note +=`, `if (false) fix.fix_published_note +=`],
  ["the choice is not recorded", PATCH, `(fix.version_choice ??= []).push(choice);`, ``],
  ["a version the registry no longer lists is used", NEXT, `if (!listed.has(version)) return "no longer listed by the registry (unpublished or withdrawn)";`, `if (!listed.has(version) && false) return "";`],
  ["a deprecated version is used", NEXT, `if (deprecated) return`, `if (false) return`],
  ["a MAL- record is not told apart", NEXT, `if (malicious.length) return`, `if (false) return`],
  ["a version OSV names is used", NEXT, `if (named.length) return`, `if (named.some(id => id.startsWith("MAL-"))) return`],
  ["a prerelease can be taken", NEXT, `semver.valid(v) === v && !semver.prerelease(v) &&`, `semver.valid(v) === v &&`],
  ["another major can be taken", NEXT, `semver.major(v) === semver.major(from) && (semver.major(from) !== 0`, `(semver.major(from) !== 0`],
  ["another minor below 1.0.0 can be taken", NEXT, `(semver.major(from) !== 0 || semver.minor(v) === semver.minor(from))).sort`, `true).sort`],
  ["no limit on the versions looked at", NEXT, `later.slice(0, NEXT_FIX_LIMIT)`, `later`],
  ["versions are not taken smallest first", NEXT, `.sort(semver.compare);`, `.sort(semver.rcompare);`],
  ["OSV is also asked about deprecated versions", NEXT, `.filter(v => listed.has(v) && !listed.get(v))`, `.filter(v => listed.has(v))`],
  ["the deprecation message is not made one line", NEXT, `deprecated.replace(/[\\x00-\\x1f\\x7f]/g, " ").slice(0, 200)`, `deprecated.slice(0, 200)`],
  ["the registry document is not checked", FACTS, `if (!doc || typeof doc !== "object" || !doc.versions || typeof doc.versions !== "object" || Array.isArray(doc.versions)) throw new Error(\`Invalid registry document for \${name}.\`);\n  return new Map(`, `return new Map(`],
];
const test = () => { try { execFileSync("npx", ["vitest", "run", "--project", "node", "packages/cli/test/dependencies.test.ts"], { stdio: "pipe" }); return true; } catch { return false; } };
console.log(`baseline passes: ${test()}`);
let caught = 0;
for (const [label, file, from, to] of mutations) {
  const original = readFileSync(file, "utf8");
  if (original.split(from).length !== 2) { console.log(`NOT APPLIED (text not found once): ${label}`); continue; }
  writeFileSync(file, original.replace(from, to));
  const passed = test();
  writeFileSync(file, original);
  if (!passed) caught++;
  console.log(`${passed ? "MISSED" : "caught"}: ${label}`);
}
console.log(`${caught} of ${mutations.length} caught`);
console.log(`after restoring, passes: ${test()}`);
