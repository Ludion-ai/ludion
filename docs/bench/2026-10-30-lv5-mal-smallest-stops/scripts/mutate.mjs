// Each mutation undoes one part of LV5 in /w; the CLI's dependency tests must fail on every one and pass without them.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const PATCH = "packages/cli/src/security/dependency-patch.ts", NEXT = "packages/cli/src/security/next-fix.ts";
const mutations = [
  ["the MAL- check on the smallest removed (the next version is looked for)", NEXT, `  if (malicious.length) {`, `  if (false) {`],
  ["a MAL- stop does not stop the fix in the patch", PATCH, `if (choice.malicious?.length || choice.publisher_check?.result === "stop")`, `if (choice.publisher_check?.result === "stop")`],
  ["a MAL- record beside another record goes on", NEXT, `  if (malicious.length) {`, `  if (malicious.length && malicious.length === named.length) {`],
  ["OSV is not asked about a deprecated or unlisted smallest", NEXT, `await ask([from], true);`, `await ask([from]);`],
  ["any id containing MAL- counts as a MAL- record", NEXT, `, malicious = named.filter(id => id.startsWith("MAL-"));`, `, malicious = named.filter(id => id.includes("MAL-"));`],
  ["later versions are asked about before the stop", NEXT, `  const named = ids.get(\`\${name}@\${from}\`)!,`, `  await ask(looked);\n  const named = ids.get(\`\${name}@\${from}\`)!,`],
  ["the stop takes the next listed version anyway", NEXT, `return { package: name, smallest: from, chosen: null, skipped: [{ version: from, reason }], malicious,`, `return { package: name, smallest: from, chosen: looked[0] ?? null, skipped: [{ version: from, reason }], malicious,`],
  ["the stop's reason leaves out the other records", NEXT, `...(others.length ? [\`OSV also names it in \${others.join(", ")}\`] : []), `, ``],
  ["the stop's reason leaves out the deprecation or absence", NEXT, `, ...(registry ? [registry] : [])].join("; ");`, `].join("; ");`],
  ["a stop does not end the fix's lookups (round 1 finding 2)", PATCH, ` stopped = true; break; }`, ` stopped = true; }`],
  ["a stopped fix's changes take an earlier change's next version (round 1 finding 2)", PATCH, `if (taken.size && !stopped) fix.changes`, `if (taken.size) fix.changes`],
  ["the receipt does not name the MAL- records", NEXT, `skipped: [{ version: from, reason }], malicious, note:`, `skipped: [{ version: from, reason }], note:`],
];
const test = () => { try { execFileSync("npx", ["vitest", "run", "--project", "node", "packages/cli/test/dependencies.test.ts"], { stdio: "pipe" }); return true; } catch { return false; } };
console.log(`baseline passes: ${test()}`);
let caught = 0;
for (const [label, file, from, to] of mutations) {
  const original = readFileSync(file, "utf8");
  if (original.split(from).length !== 2) { console.log(`NOT APPLIED (text not found once): ${label}`); continue; }
  writeFileSync(file, original.split(from).join(to));
  const passed = test();
  writeFileSync(file, original);
  if (!passed) caught++;
  console.log(`${passed ? "MISSED" : "caught"}: ${label}`);
}
console.log(`${caught} of ${mutations.length} caught`);
console.log(`after restoring, passes: ${test()}`);
