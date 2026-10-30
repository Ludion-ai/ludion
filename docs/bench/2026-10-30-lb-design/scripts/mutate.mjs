// Each mutation undoes one check of the scheduled workflow's two jobs. The named test file must fail with it, and pass
// without it. Usage (in /w, after npm ci): node /scripts/mutate.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const D = "packages/cli/src/security/deliver.ts", T = "packages/cli/test/deliver.test.ts", A = "packages/cli/test/action-patch.test.ts";
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
  off("composer.lock: a new package nothing requires accepted", "if (stray.length) return"),
  ["composer: the backtracking name pattern (CodeQL js/redos) back", D, "/^[a-z0-9][a-z0-9_.-]*\\/[a-z0-9][a-z0-9_.-]*$/", "/^[a-z0-9]([_.-]?[a-z0-9]+)*\\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/", T],
  off("composer and Maven: a downgrade accepted", "if (!from || !to || !semver.gt(to, from)) return"),
  off("composer: a from the base does not lock accepted", "if (!fix.changes.some(c => c.from.replace(/^v(?=\d)/, \"\") === String(earlier.version ?? \"\").replace(/^v(?=\d)/, \"\"))) return"),
  off("npm: another package moving accepted", "if (gone.length) return"),
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
  ["any advisory text accepted", D, "const ADVISORY = /^[A-Za-z][A-Za-z0-9]{1,15}-[A-Za-z0-9._:-]{1,100}$/;", "const ADVISORY = /^.+$/;", T],
  off("a bundle without an applied fix accepted", "if (hasBundle) refuse("),
  off("pack: a branch not at the receipt's commit packed", "if (tip !== commit) throw"),
  ["patch mode: an OIDC token allowed", "action/start.sh", "if [ -n \"${ACTIONS_ID_TOKEN_REQUEST_URL:-}\" ]; then", "if false; then", A],
  ["template: the validation job may write", "action/patch-workflow.yml", "      contents: read\n", "      contents: write\n", A],
  ["action: the checkout keeps the credential", "action.yml", "persist-credentials: false\n        fetch-depth: 1", "persist-credentials: true\n        fetch-depth: 1", A],
  ["action: the validation step gets the token", "action.yml", "        OUT: ${{ runner.temp }}/ludion/fixes\n      run: bash", "        OUT: ${{ runner.temp }}/ludion/fixes\n        GH_TOKEN: ${{ github.token }}\n      run: bash", A],
];
const vitest = file => { try { execFileSync("npx", ["vitest", "run", "--project", "node", file], { stdio: "pipe", env: { ...process.env, NO_COLOR: "1" } }); return "pass"; } catch { return "fail"; } };
let caught = 0;
for (const [name, file, from, to, test] of mutations) {
  const original = readFileSync(file, "utf8");
  if (original.split(from).length !== 2) { console.log(`NOT APPLIED  ${name} (the text is not found exactly once)`); continue; }
  writeFileSync(file, original.replace(from, to));
  const result = vitest(test);
  writeFileSync(file, original);
  if (result === "fail") caught++;
  console.log(`${result === "fail" ? "caught      " : "NOT CAUGHT  "} ${name} — ${test}`);
}
console.log(`${caught} of ${mutations.length} caught; without mutations: ${[...new Set(mutations.map(m => m[4]))].map(t => `${t} ${vitest(t)}`).join(", ")}`);
