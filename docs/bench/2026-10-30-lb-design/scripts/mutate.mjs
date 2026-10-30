// Each mutation undoes one check of the scheduled workflow's two jobs. The named test file must fail with it, and pass
// without it. A test run that does not end within LIMIT is stopped (its whole process group) and reported apart: the
// ReDoS mutation makes vitest spin without end (review 6516135819, N7). Usage (in /w, after npm ci): node /scripts/mutate.mjs
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const D = "packages/cli/src/security/deliver.ts", T = "packages/cli/test/deliver.test.ts", A = "packages/cli/test/action-patch.test.ts";
const B = "packages/cli/src/security/branch.ts", BT = "packages/cli/test/branch.test.ts";
const LIMIT = 300_000;
/** `text` starts with "if (": its whole condition, up to the matching ")", becomes false. */
const off = (name, text) => {
  let depth = 0, end = -1;
  for (let i = 3; i < text.length; i++) { if (text[i] === "(") depth++; if (text[i] === ")" && --depth === 0) { end = i; break; } }
  if (end < 0) throw new Error(`${name}: no matching parenthesis`);
  return [name, D, text, `if (false)${text.slice(end + 1)}`, T];
};
const mutations = [
  off("a parent other than the base accepted", "if (c.parents.length !== 1 || c.parents[0] !== base) refuse("),
  off("files outside the receipt's list accepted", "if ([...paths].sort().join(\"\\0\") !== wanted.join(\"\\0\")) refuse("),
  off("a file the plan may not change accepted", "if (!policy.allowed.includes(path)) refuse("),
  off("a new file or a changed mode accepted", "if (status !== \"M\" || oldMode !== newMode || modes.get(paths[i]!) !== newMode || !/^100(644|755)$/.test(newMode!)) refuse("),
  ["an executable mode refused (a checkout from a file system without modes)", D, "!/^100(644|755)$/.test(newMode!)", "!/^100644$/.test(newMode!)", T],
  off("extra branches in the bundle accepted", "if (listed.join(\"\\n\") !== expected.join(\"\\n\")) refuse("),
  ["bytes other than the receipt's accepted", D, "!== file.after_hash) refuse(", "!== file.after_hash && false) refuse(", T],
  off("a second PR while one is open", "if (open) { done("),
  off("a closed fix opened again", "if (closed) { done("),
  off("a PR opened on a branch that holds another commit", "if (remoteSha && remoteCommit !== fix.commit) {"),
  ["a branch with another change reused", D, "earlier.status === 200 && e?.tree?.sha === fix.tree && ", "earlier.status === 200 && ", T],
  off("the message beyond its subject accepted", "if (c.message !== fix.message) refuse("),
  off("what the files say not checked", "if (problem) refuse("),
  off("npm: the judge's second refusal ignored", "if (refusal) throw new Error(`Not pushed"),
  ["npm: the judge not run again", D, "if (checked.ecosystem === \"npm\") {", "if (false) {", T],
  off("manifest: another package.json accepted", "if (!same) return"),
  off("PHP: more than the FROM image accepted", "if (!now.startsWith(head) || !now.endsWith(tail) || now.length < head.length + tail.length || !official.test(image)) return"),
  off("PHP: an older or other-branch release accepted", "if (!/^\\d+\\.\\d+\\.\\d+$/.test(to) || !to.startsWith(`${current.branch}.`) || compare(to, current.version) <= 0) return"),
  off("composer.lock: another package changed", "if (!isDeepStrictEqual(withoutMetadata(earlier), withoutMetadata(entry))) return"),
  off("composer.lock: a plugin accepted", "if (typeof entry.type === \"string\" && /^composer-(plugin|installer)$/.test(entry.type)) return"),
  off("composer.lock: a new package from any archive accepted", "if (!archiveRepository(isObject(entry.dist) ? entry.dist.url : \"\")) return"),
  off("composer.lock: the planned package from another repository accepted", "if (!repository || repository !== archiveRepository(old(\"dist\", \"url\"))) return"),
  off("composer.lock: a new package nothing requires accepted", "if (stray.length) return `composer.lock adds"),
  ["composer: the backtracking name pattern (CodeQL js/redos) back", D, "/^[a-z0-9][a-z0-9_.-]*\\/[a-z0-9][a-z0-9_.-]*$/", "/^[a-z0-9]([_.-]?[a-z0-9]+)*\\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/", T],
  off("composer and Maven: a downgrade accepted", "if (!from || !to || !semver.gt(to, from)) return"),
  off("composer: a from the base does not lock accepted", "if (!fix.changes.some(c => c.from.replace(/^v(?=\\d)/, \"\") === String(earlier.version ?? \"\").replace(/^v(?=\\d)/, \"\"))) return"),
  off("npm: another lock entry changing accepted", "if (!isDeepStrictEqual(before, after)) return"),
  ["npm: the entry's own name trusted", D, "kinds.get(path) === \"install\" && requireName(path) === fix.package && !!item && (item.name === undefined || item.name === fix.package)", "kinds.get(path) === \"install\" && !!item && (typeof item.name === \"string\" ? item.name : requireName(path)) === fix.package", T],
  ["composer and Maven: OSV not asked", D, "if (checked.ecosystem === \"composer\" || checked.ecosystem === \"maven\") {", "if (false) {", T],
  off("composer and Maven: OSV's advisories ignored", "if (ids.length) throw new Error(`Not pushed: OSV lists"),
  ["composer: Packagist not asked", D, "if (checked.ecosystem === \"composer\") {", "if (false) {", T],
  off("composer: an entry other than Packagist's release accepted", "if (!isDeepStrictEqual(entry[key], listed[key])) return"),
  off("composer.lock: keys Ludion does not check accepted", "if ((entry.name === fix.package || !earlier) && unknown.length) return"),
  ["PHP: Docker Hub not asked", D, "if (checked.ecosystem === \"php\") {", "if (false) {", T],
  ["PHP: another digest under the tag accepted", D, "return listed === match[2] ? null :", "return true ? null :", T],
  off("composer.lock: a new notification-url accepted", "if (entry[\"notification-url\"] !== undefined && entry[\"notification-url\"] !== PACKAGIST_NOTIFY) return"),
  off("composer.lock: a name listed twice accepted", "if (twice.length) return"),
  off("composer.lock: a removed package accepted", "if (!seen.has(name) && name !== fix.package) return"),
  off("composer.lock: another top-level key accepted", "if (![\"content-hash\", \"packages\", \"packages-dev\", \"plugin-api-version\"].includes(key) && !isDeepStrictEqual(a[key], b[key])) return"),
  ["the push forced", D, "remote, `${commit}:refs/heads/${branch}`]", "remote, `+${commit}:refs/heads/${branch}`]", T],
  ["the token in the push's arguments", D, "return { args: [\"-C\", top,", "return { args: [\"-c\", `http.extraheader=${token}`, \"-C\", top,", T],
  off("a run off the default branch opens PRs", "if (options.ref !== `refs/heads/${defaultBranch}`) throw"),
  ["a checkout at another commit accepted", D, "!== base) throw new Error(`The checkout is not at the base", "!== base && false) throw new Error(`The checkout is not at the base", T],
  off("another author accepted", "if (!IDENTITY.test(c.author) || !IDENTITY.test(c.committer)) refuse("),
  off("another subject accepted", "if (c.message.split(\"\\n\")[0] !== fix.subject) refuse("),
  off("another branch name accepted", "if (fix.branch !== fixBranchName(prefix, policy.ecosystem, pkg, changes.map(c => c.to))) refuse("),
  off("an npm fix without the judge's ready_except_build accepted", "if (policy.ecosystem === \"npm\" && verdict !== \"ready_except_build\") refuse("),
  off("a fix whose tests failed accepted", "if (r.baseline_passed !== true || f.candidate_passed !== true) refuse("),
  ["another base_commit accepted", D, "a fix whose tests did not pass.\");\n    if (text(r.base_commit, SHA, \"base_commit\") !== base)", "a fix whose tests did not pass.\");\n    if (false)", T],
  off("an oversized bundle accepted", "if (size(bundleFile) > BUNDLE_LIMIT) refuse("),
  ["any advisory text accepted", D, "export const ADVISORY = /^(?:GHSA", "export const ADVISORY = /^.+$|^(?:GHSA", T],
  ["advisories of any prefix accepted (GH-1)", D, "export const ADVISORY = /^(?:GHSA", "export const ADVISORY = /^[A-Za-z][A-Za-z0-9]{1,15}-[A-Za-z0-9._:-]{1,100}$|^(?:GHSA", T],
  ["the parents read from the raw headers, not from Git", D, "const [, ...parents] = git(top, [\"rev-list\", \"--parents\", \"-n\", \"1\", commit]).stdout.trim().split(\" \");", "const parents = headers.filter(h => h.startsWith(\"parent \")).map(h => h.slice(7));", T],
  off("headers out of Git's order accepted", "if (!c.inOrder) refuse("),
  ["git fsck not run", D, "try { git(top, [\"fsck\", \"--no-dangling\", \"--no-reflogs\", \"--no-progress\", ...checked.fixes.map(f => f.commit)]); }", "try { }", T],
  off("a changed file of any size accepted", "if (bytes(fix.commit) > limit) refuse("),
  off("npm: a from the base's lock does not have accepted", "if (!planned.some(path => entry(was, path)!.version === change.from)) return"),
  off("npm: a lock without the fix's version at the planned path accepted", "if (!ours(path, entry(is, path)) || entry(is, path)!.version !== wanted) return"),
  off("npm: a lock that still has the moved version accepted", "if (kinds.get(path) === \"install\" && requireName(path) === fix.package && to.has(version) && !tos.has(version)) return"),
  // Review 6518582507: B1, N-a and N-b.
  off("npm: a lock key that is not an install path accepted (B1)", "if (kind === \"folder\") return"),
  off("npm: a new package nothing requires accepted (N-a)", "if (stray.length) return `package-lock.json adds"),
  off("npm: a removed lock entry accepted (N-a)", "if (!after) return"),
  off("npm: an added link or folder accepted (N-a)", "if (kinds.get(path) !== \"install\" || after.link) return"),
  off("npm: the root's other requirements changed (N-a)", "if (!isDeepStrictEqual(root(before), root(after))) return"),
  ["npm: an alias at the planned path accepted (N-a c)", D, " && (item.name === undefined || item.name === fix.package) && !item.link;", " && !item.link;", T],
  ["npm: from matched against any package's versions (R5)", D, "kinds.get(path) === \"install\" && requireName(path) === fix.package && !!item", "kinds.get(path) === \"install\" && !!item", T],
  ["the tree read from the raw headers, not from Git (R4)", D, "const tree = git(top, [\"rev-parse\", \"--verify\", `${commit}^{tree}`]).stdout.trim();", "const tree = (headers[0] ?? \"\").slice(\"tree \".length);", T],
  ["branch names: a version with \"-\" kept readable (R16)", B, "!tos[0]!.includes(\"-\") && ", "", BT],
  ["packagist: a PKSA ID with a \"-\" at an end read (N-d)", "packages/cli/src/security/packagist.ts", "export const PKSA_ID = /^PKSA-[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;", "export const PKSA_ID = /^PKSA-[a-z0-9-]{1,60}$/;", "packages/cli/test/dependencies.test.ts"],
  ["a closed PR's fix not warned about", D, ".filter(d => d.outcome === \"closed_pr_exists\").map(", ".filter(d => false).map(", T],
  ["deliver open does not print the warnings", D, "  for (const line of closedWarnings(deliveries)) console.error(line);\n", "", T],
  ["branch names: cleaned names merged again (no hash)", B, "plainName ? readable : `${readable}-${id}`", "readable", BT],
  off("a bundle without an applied fix accepted", "if (hasBundle) refuse("),
  off("pack: a branch not at the receipt's commit packed", "if (tip !== commit) throw"),
  ["scheduled modes: a self-hosted runner accepted", "action/start.sh", "if [ \"${RUNNER_ENVIRONMENT:-}\" != \"github-hosted\" ]; then", "if false; then", A],
  ["template: setup-node's cache in the validation job", "action/patch-workflow.yml", "          package-manager-cache: false\n      - id: ludion\n", "      - id: ludion\n", A],
  ["template: setup-node's cache in the PR job", "action/patch-workflow.yml", "          package-manager-cache: false\n      - uses: Ludion-ai/ludion@0000000000000000000000000000000000000000 # a release commit's SHA; none exists yet\n        with:\n          mode: pull-request", "      - uses: Ludion-ai/ludion@0000000000000000000000000000000000000000 # a release commit's SHA; none exists yet\n        with:\n          mode: pull-request", A],
  ["patch mode: an OIDC token allowed", "action/start.sh", "if [ -n \"${ACTIONS_ID_TOKEN_REQUEST_URL:-}\" ]; then", "if false; then", A],
  ["template: the validation job may write", "action/patch-workflow.yml", "      contents: read\n", "      contents: write\n", A],
  ["action: the checkout keeps the credential", "action.yml", "persist-credentials: false\n        fetch-depth: 1", "persist-credentials: true\n        fetch-depth: 1", A],
  ["action: the validation step gets the token", "action.yml", "        OUT: ${{ runner.temp }}/ludion/fixes\n      run: bash", "        OUT: ${{ runner.temp }}/ludion/fixes\n        GH_TOKEN: ${{ github.token }}\n      run: bash", A],
];
/** "pass", "fail", or "timeout" when the run does not end within LIMIT; then its whole process group is killed. */
const vitest = file => new Promise(resolve => {
  const child = spawn("npx", ["vitest", "run", "--project", "node", file], { stdio: "ignore", detached: true, env: { ...process.env, NO_COLOR: "1" } });
  const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} resolve("timeout"); }, LIMIT);
  child.on("exit", code => { clearTimeout(timer); resolve(code === 0 ? "pass" : "fail"); });
});
let caught = 0, timedOut = 0;
for (const [i, [name, file, from, to, test]] of mutations.entries()) {
  const original = readFileSync(file, "utf8");
  if (original.split(from).length !== 2) { console.log(`${i + 1}. NOT APPLIED  ${name} (the text is not found exactly once)`); continue; }
  writeFileSync(file, original.replace(from, to));
  const started = Date.now(), result = await vitest(test);
  writeFileSync(file, original);
  if (result !== "pass") caught++;
  if (result === "timeout") timedOut++;
  const label = { fail: "caught", timeout: `caught: no end within ${LIMIT / 1000} s`, pass: "NOT CAUGHT" }[result];
  console.log(`${i + 1}. ${label}  ${name} — ${test} (${Math.round((Date.now() - started) / 1000)} s)`);
}
const clean = [];
for (const t of new Set(mutations.map(m => m[4]))) clean.push(`${t} ${await vitest(t)}`);
console.log(`${caught} of ${mutations.length} caught, ${timedOut} of them by the time limit; without mutations: ${clean.join(", ")}`);
