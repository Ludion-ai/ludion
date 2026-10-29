// Each mutation undoes one property of the per-fix apply. The named test file must fail with it, and pass without it.
// Usage (in /w, after npm ci): node /scripts/mutate.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const mutations = [
  ["no hooks override", "packages/cli/src/security/branch.ts", "const config = [`core.hooksPath=${hooks}`, ", "const config = [", "packages/cli/test/branch.test.ts"],
  ["git started in the project's folder", "packages/cli/src/security/branch.ts", "{ cwd: hooks, env,", "{ cwd: dir, env,", "packages/cli/test/branch.test.ts"],
  ["no executable-bit check", "packages/cli/src/security/branch.ts", "(lstatSync(full).mode & 0o100 ? \"100755\" : \"100644\") === entry.mode", "true", "packages/cli/test/branch.test.ts"],
  ["every fix skipped reads applied", "packages/cli/src/security/dependency-patch.ts", ": !done.length ? \"skipped\" : apply", ": apply", "packages/cli/test/dependencies.test.ts"],
  ["no configuration check before a branch", "packages/cli/src/security/branch.ts", "  refuseConfiguration(base.top);\n", "", "packages/cli/test/branch.test.ts"],
  ["two fixes on one branch name", "packages/cli/src/security/dependency-patch.ts", "else if (branch && branches.indexOf(branch) !== index)", "else if (false)", "packages/cli/test/dependencies.test.ts"],
  ["a symbolic ref at the name accepted", "packages/cli/src/security/branch.ts", "ref], { allowFail: true }).status === 0) throw", "ref], { allowFail: true }).status === 0 && false) throw", "packages/cli/test/branch.test.ts"],
  ["reftable accepted","packages/cli/src/security/branch.ts","if (storage.status === 0 && storage.stdout.trim().toLowerCase() !== \"files\") throw","if (false) throw","packages/cli/test/branch.test.ts"],
  ["a link at an object file accepted","packages/cli/src/security/branch.ts","  for (const oid of objects) check(","  for (const oid of []) check(","packages/cli/test/branch.test.ts"],
  ["partial clone accepted", "packages/cli/src/security/branch.ts", "  if (promisor.length) throw", "  if (promisor.length && false) throw", "packages/cli/test/branch.test.ts"],
  ["hooks named in configuration accepted", "packages/cli/src/security/branch.ts", "  if (hooks.length) throw", "  if (hooks.length && false) throw", "packages/cli/test/branch.test.ts"],
  ["CRLF committed as checked out", "packages/cli/src/security/branch.ts", "base.crlf.has(file.path) ? file.content.replace(/\\r\\n/g, \"\\n\") : file.content", "file.content", "packages/cli/test/branch.test.ts"],
  ["a path HEAD lacks is added", "packages/cli/src/security/branch.ts", "  if (unknown.length) throw", "  if (unknown.length && false) throw", "packages/cli/test/branch.test.ts"],
  ["a taken branch name reads skipped", "packages/cli/src/security/dependency-patch.ts", "if (base && branch && tip?.subject === subject(fix)) {", "if (base && branch && tip) {", "packages/cli/test/dependencies.test.ts"],
  ["a fix goes on beside its package's unfixable finding", "packages/cli/src/security/dependency-patch.ts", "        if (blocked.length) throw", "        if (blocked.length && false) throw", "packages/cli/test/dependencies.test.ts"],
  ["unfixed findings ignored in the outcome", "packages/cli/src/security/dependency-patch.ts", ": failed || unplanned.length ? \"partial\"", ": failed ? \"partial\"", "packages/cli/test/dependencies.test.ts"],
  ["PHP: a taken branch name reads skipped", "packages/cli/src/security/patch.ts", "if (tip !== null && tip.subject !== subject) throw", "if (false) throw", "packages/cli/test/security.test.ts"],
  ["no fsmonitor override", "packages/cli/src/security/branch.ts", "\"core.fsmonitor=\", ", "", "packages/cli/test/branch.test.ts"],
  ["fsmonitor set to false", "packages/cli/src/security/branch.ts", "\"core.fsmonitor=\", ", "\"core.fsmonitor=false\", ", "packages/cli/test/branch.test.ts"],
  ["replace refs read", "packages/cli/src/security/branch.ts", [["\"--no-replace-objects\", ", ""], [", GIT_NO_REPLACE_OBJECTS: \"1\" }", " }"]], null, "packages/cli/test/branch.test.ts"],
  ["no clean-tree check", "packages/cli/src/security/branch.ts", "  if (differs.length) throw", "  if (differs.length && false) throw", "packages/cli/test/branch.test.ts"],
  // The reflog refusal also stops an existing branch before update-ref, so both defences go.
  ["an existing branch is moved","packages/cli/src/security/branch.ts",[["ref, commit, \"0\".repeat(base.commit.length)]","ref, commit]"],["  if (existsSync(join(common, \"logs\", ...parts))) throw","  if (false) throw"]],null,"packages/cli/test/branch.test.ts"],
  ["every fix in one candidate", "packages/cli/src/security/dependency-patch.ts", "candidate = await acquire(label, fix.changes);", "candidate = await acquire(label, scan.plan);", "packages/cli/test/dependencies.test.ts"],
  ["a failing fix stops the rest", "packages/cli/src/security/dependency-patch.ts", "} catch (error) { fix.outcome = \"failed\"; fix.reason = error instanceof Error ? error.message : String(error); }", "} catch (error) { fix.outcome = \"failed\"; fix.reason = error instanceof Error ? error.message : String(error); throw error; }", "packages/cli/test/dependencies.test.ts"],
  ["apply writes the working tree", "packages/cli/src/security/dependency-patch.ts", "          fix.commit = fixBranch(", "          for (const f of files) writeFileSync(join(root, f.path), f.after);\n          fix.commit = fixBranch(", "packages/cli/test/dependencies.test.ts"],
  ["no publish time", "packages/cli/src/security/dependency-patch.ts", "fix.fix_published_at = published.at;", "fix.fix_published_at = null;", "packages/cli/test/dependencies.test.ts"],
  ["PHP: no publish time", "packages/cli/src/security/patch.ts", "fix_published_at: published.at,", "fix_published_at: null,", "packages/cli/test/security.test.ts"],
  ["PHP: branch for an existing one", "packages/cli/src/security/patch.ts", "    if (base && branch && tip?.subject === subject) {", "    if (false) {", "packages/cli/test/security.test.ts"],
  ["npm carries another package within a known advisory","packages/cli/src/security/dependency-patch.ts","const carried = ecosystem === \"maven\" ?","const carried = true ?","packages/cli/test/dependencies.test.ts"],
  ["a new advisory accepted","packages/cli/src/security/dependency-patch.ts","...added.filter(f => !carried.includes(f))","","packages/cli/test/dependencies.test.ts"],
  ["a baseline MAL- record accepted","packages/cli/src/security/dependency-patch.ts","    if (marked.length) throw","    if (marked.length && false) throw","packages/cli/test/dependencies.test.ts"],
  ["a symbolic link in .git accepted","packages/cli/src/security/branch.ts","  if (linked.length) throw","  if (linked.length && false) throw","packages/cli/test/branch.test.ts"],
  ["an existing reflog accepted","packages/cli/src/security/branch.ts","  if (existsSync(join(common, \"logs\", ...parts))) throw","  if (false) throw","packages/cli/test/branch.test.ts"],
];
const vitest = file => { try { execFileSync("npx", ["vitest", "run", "--project", "node", file], { stdio: "pipe", env: { ...process.env, NO_COLOR: "1" } }); return "pass"; } catch { return "fail"; } };
let caught = 0;
for (const [name, file, from, to, test] of mutations) {
  const original = readFileSync(file, "utf8");
  // A mutation is one replacement, or (from as a list) several.
  const pairs = Array.isArray(from) ? from : [[from, to]];
  if (pairs.some(([a]) => original.split(a).length !== 2)) { console.log(`NOT APPLIED  ${name} (the text is not found exactly once)`); continue; }
  writeFileSync(file, pairs.reduce((text, [a, b]) => text.replace(a, b), original));
  const result = vitest(test);
  writeFileSync(file, original);
  if (result === "fail") caught++;
  console.log(`${result === "fail" ? "caught      " : "NOT CAUGHT  "} ${name} — ${test}`);
}
console.log(`${caught} of ${mutations.length} caught; without mutations: ${[...new Set(mutations.map(m => m[4]))].map(t => `${t} ${vitest(t)}`).join(", ")}`);
