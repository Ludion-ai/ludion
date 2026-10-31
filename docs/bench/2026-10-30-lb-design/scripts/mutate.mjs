// Each mutation undoes one check of the scheduled workflow's two jobs. The named test file must fail with it, and pass
// without it. A test run that does not end within LIMIT is stopped (its whole process group) and reported apart: the
// ReDoS mutation makes vitest spin without end (review 6516135819, N7). Usage (in /w, after npm ci): node /scripts/mutate.mjs
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const D = "packages/cli/src/security/deliver.ts", T = "packages/cli/test/deliver.test.ts", A = "packages/cli/test/action-patch.test.ts";
const B = "packages/cli/src/security/branch.ts", BT = "packages/cli/test/branch.test.ts";
const J = "packages/cli/src/security/judge.ts", JT = "packages/cli/test/judge.test.ts", C = "packages/cli/test/npm-corpus.test.ts";
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
  off("npm: another lock entry changing accepted", "if (!sameButFlags(before, after)) return"),
  ["npm: the entry's own name not read (an alias of the package not planned, B2 of 217a6f8)", D, "(typeof item.name === \"string\" ? item.name : requireName(path)) === fix.package;", "requireName(path) === fix.package;", T],
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
  off("npm: a lock that still has the moved version accepted", "if (ours(path, entry(is, path)) && to.has(version) && !tos.has(version)) return"),
  // Review 6518582507: B1, N-a and N-b.
  off("npm: a lock key that is not an install path accepted (B1)", "if (kind === \"folder\") return"),
  off("npm: a new package nothing requires accepted (N-a)", "if (stray.length) return `package-lock.json adds"),
  off("npm: a removed lock entry accepted (N-a)", "if (!after) return"),
  off("npm: an added link or folder accepted (N-a)", "if (kinds.get(path) !== \"install\" || after.link) return"),
  off("npm: the root's other requirements changed (N-a)", "if (!isDeepStrictEqual(root(before), root(after))) return"),
  ["npm: an alias of another package at the planned path accepted (N-a c)", D, "(typeof item.name === \"string\" ? item.name : requireName(path)) === fix.package;", "(requireName(path) === fix.package || item.name === fix.package);", T],
  ["npm: from matched against any package's versions (R5)", D, " && (typeof item.name === \"string\" ? item.name : requireName(path)) === fix.package;", ";", T],
  // Review of 7d25696 (lane): B1 (A) and (B), N3.
  ["npm: the registry not asked about moved and added entries (B1 A)", D, "const problem = await npmAgain(top, prefix, checked.base, fix, options.npmManifest ?? ((name, version) => registryManifest(name, version)));", "const problem = null;", T],
  off("npm: an entry's requirements other than the registry's accepted (B1 A)", "if (!isDeepStrictEqual(lock[key], registry[key])) return"),
  off("npm: an entry the registry does not list accepted (B1 A)", "if (!listed) return `the registry lists no"),
  off("npm: another package loading another copy accepted (B1 B)", "if (then !== now) return"),
  ["npm: the lock not read as the judge reads it (N3)", D, "    lockEntries(old); lockEntries(now);\n", "", T],
  // Review of aa5d75b (lane): B1, the lock as every npm reads it (judge.ts's readLock, which the PR job also uses).
  ["lock views: a disagreeing npm 6 tree accepted", J, "if (a !== b) throw new Error(`package-lock.json's packages and", "if (false) throw new Error(`package-lock.json's packages and", JT],
  ["lock views: the npm 6 tree not walked", J, "  walk(tree, \"\");\n", "", JT],
  ["lock views: a link's children read under the link, not its folder", J, "const dir = linked && typeof linked.resolved === \"string\" ? `${linked.resolved}/` : `${path}/`;", "const dir = `${path}/`;", JT],
  ["lock views: an alias read without its real name", J, "alias ? `npm:${item.name}@${field(item.version)}` :", "alias ? field(item.version) :", JT],
  ["lock: another lockfileVersion read", J, "(top.lockfileVersion !== 2 && top.lockfileVersion !== 3)", "false", JT],
  ["lock: a top-level key npm does not write read", J, "if (unknown.length) throw new Error(`package-lock.json has a top-level key", "if (false) throw new Error(`package-lock.json has a top-level key", JT],
  ["lock views: the review's tree attack through the PR job", J, "if (a !== b) throw new Error(`package-lock.json's packages and", "if (false) throw new Error(`package-lock.json's packages and", T],
  off("npm: the top-level lockfileVersion changed", "if (key !== \"packages\" && key !== \"dependencies\" && !isDeepStrictEqual(baseTop![key], fixTop![key])) return"),
  off("npm: a base with npm-shrinkwrap.json accepted", "if (ecosystem === \"npm\" && before(\"npm-shrinkwrap.json\") !== null) return"),
  ["judge: package-lock.json judged beside npm-shrinkwrap.json", "packages/cli/src/security/judge-cli.ts", "for (const dir of [before, after]) if (existsSync(join(dir, \"npm-shrinkwrap.json\")))", "for (const dir of [before, after]) if (false)", "packages/cli/test/judge-cli.test.ts"],
  // Review of 1e6f705 (lane): B1, the tree's requires and flags; N1, a moved entry's optional and peer dependencies.
  ["lock views: the tree's requires not compared", J, "const a = packagesView.get(path)?.key, b = treeView.get(path)?.key;", "const a = packagesView.get(path)?.key.replace(/\\0[^\\0]*$/, \"\"), b = treeView.get(path)?.key.replace(/\\0[^\\0]*$/, \"\");", JT],
  ["lock views: the tree's requires attack through the PR job", J, "const a = packagesView.get(path)?.key, b = treeView.get(path)?.key;", "const a = packagesView.get(path)?.key.replace(/\\0[^\\0]*$/, \"\"), b = treeView.get(path)?.key.replace(/\\0[^\\0]*$/, \"\");", T],
  ["lock views: the flags not compared", J, "const TREE_FLAGS = [\"dev\", \"optional\", \"devOptional\", \"peer\", \"bundled\"];", "const TREE_FLAGS: string[] = [];", JT],
  ["lock views: a tree key npm does not write read", J, "if (unknown.length) throw new Error(`package-lock.json's dependencies tree gives", "if (false) throw new Error(`package-lock.json's dependencies tree gives", JT],
  ["lock views: a link's requires without its folder's devDependencies", J, "requirementList(folder?.dependencies, folder?.optionalDependencies, folder?.devDependencies)", "requirementList(folder?.dependencies, folder?.optionalDependencies)", JT],
  ["lock views: extraneous and from read in the tree (the closed list)", J, "const TREE_KEYS = new Set([\"version\", \"resolved\", \"integrity\", \"dev\", \"optional\", \"devOptional\", \"peer\", \"bundled\", \"requires\", \"dependencies\"]);", "const TREE_KEYS = new Set([\"version\", \"resolved\", \"integrity\", \"dev\", \"optional\", \"devOptional\", \"peer\", \"extraneous\", \"from\", \"bundled\", \"requires\", \"dependencies\"]);", JT],
  // Review of ebfe89d (lane): B1, every requirement found in its range by Node's lookup, in both views.
  ["requirements: an unmet requirement accepted", J, "    if (found && (overridden.length ? overridden.some(s => takes(found, name, s)) : takes(found, name, spec))) continue;", "    continue;", JT],
  ["requirements: an unmet requirement accepted, through the PR job", J, "    if (found && (overridden.length ? overridden.some(s => takes(found, name, s)) : takes(found, name, spec))) continue;", "    continue;", T],
  ["requirements: a version outside the range accepted", J, "return found.name === wanted && semver.satisfies(found.version, range, { loose: true });", "return found.name === wanted;", JT],
  ["requirements: a copy of another package under the name accepted", J, "return found.name === wanted && semver.satisfies", "return semver.satisfies", JT],
  ["requirements: a required peer not looked for", J, "needs: [...requires, ...peers], peers:", "needs: requires, peers:", JT],
  ["requirements: an optional peer required", J, ".filter(([name]) => !(isPlain(meta[name]) && meta[name].optional === true));", ";", JT],
  ["requirements: the project's own requirements not looked for", J, "...requirementsMet(packagesView, projects(top.packages), \"packages\", project.overrides, project),", "...requirementsMet(packagesView, [], \"packages\", project.overrides, project),", JT],
  // Review 6529858505 (R lane): B1 (overrides, --legacy-peer-deps, compared with the base), N1 (libc), N2 (merge commit).
  ["requirements: overrides not read", J, "const overridden = overrideSpecs(overrides, project, view, consumer.path, name, spec);", "const overridden: string[] = [];", JT],
  ["requirements: a nested override applied everywhere", J, "if (isPlain(value) && ancestors.some(a => a.name === rule.name && takes(rule.selector, range => semver.satisfies(a.version, range, { loose: true })))) walk(value);", "if (isPlain(value)) walk(value);", JT],
  ["requirements: an override key's selector ignored (security pass at 549fe1e)", J, "if (rule.name === name && takes(rule.selector, range => semver.validRange(spec, { loose: true }) !== null && semver.intersects(spec, range, { loose: true }))) {", "if (rule.name === name) {", JT],
  ["requirements: a nested key's selector ignored (security pass at 549fe1e)", J, "ancestors.some(a => a.name === rule.name && takes(rule.selector, range => semver.satisfies(a.version, range, { loose: true })))", "ancestors.some(a => a.name === rule.name)", JT],
  ["requirements: the base's own unmet requirements refused too", J, "].filter(([key]) => !had.has(key)).map(", "].filter(() => true).map(", JT],
  ["requirements: a peer keyed with its spec (a --legacy-peer-deps lock's move refused)", J, "peer ? \"<peer>\" : spec", "spec", JT],
  off("npm: the PR job does not compare requirements with the base", "if (unmet.length) return plain(unmet[0]!).slice(0, 400);"),
  ["judge: packageLockInputs does not compare requirements with the base", "packages/cli/src/security/judge-cli.ts", "  if (unmet.length) throw new Error(`The change leaves a requirement unmet", "  if (false) throw new Error(`The change leaves a requirement unmet", "packages/cli/test/judge-cli.test.ts"],
  ["npm: a moved entry's libc not compared with the registry (N1)", D, "for (const key of [\"requires\", \"peers\", \"peersMeta\", \"os\", \"cpu\", \"libc\"] as const) {", "for (const key of [\"requires\", \"peers\", \"peersMeta\", \"os\", \"cpu\"] as const) {", T],
  ["the shadow check reads only an unmoved entry's dependencies (N2, R24)", D, "for (const group of path ? DECLARED : ROOT_GROUPS) for (const name of isObject(item[group])", "for (const group of path ? [\"dependencies\"] : ROOT_GROUPS) for (const name of isObject(item[group])", T],
  ["the shadow check reads only the project's dependencies (N2, R25)", D, "for (const group of path ? DECLARED : ROOT_GROUPS) for (const name of isObject(item[group])", "for (const group of path ? DECLARED : [\"dependencies\"]) for (const name of isObject(item[group])", T],
  ["a merge commit with the base as its first parent accepted (N2, R22)", D, "if (c.parents.length !== 1 || c.parents[0] !== base)", "if (c.parents[0] !== base)", T],
  off("npm: a tree added to a base without one accepted", "if (Object.hasOwn(baseTop!, \"dependencies\") !== Object.hasOwn(fixTop!, \"dependencies\")) return"),
  ["npm: a moved entry's peerDependencies not compared with the registry (N1)", D, "for (const key of [\"requires\", \"peers\", \"peersMeta\", \"os\", \"cpu\", \"libc\"] as const) {", "for (const key of [\"requires\", \"peersMeta\", \"os\", \"cpu\", \"libc\"] as const) {", T],
  ["npm: a moved entry's optionalDependencies not compared with the registry (N1)", D, ", ...(isObject(item.optionalDependencies) ? item.optionalDependencies : {}) },", " },", T],
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
  // Review 6533374683 (R lane, R215b) and the npm corpus (docs/decisions/2026-10-31-lock-corpus-against-npm.md).
  ["lock views: devOptional and peer refused in the tree (B1; npm 7 to 11 write them)", J, "const TREE_KEYS = new Set([\"version\", \"resolved\", \"integrity\", \"dev\", \"optional\", \"devOptional\", \"peer\", \"bundled\", \"requires\", \"dependencies\"]);", "const TREE_KEYS = new Set([\"version\", \"resolved\", \"integrity\", \"dev\", \"optional\", \"bundled\", \"requires\", \"dependencies\"]);", C],
  ["lock views: the tree's requires compared by spec (an override's spec in the tree refused)", J, "TREE_FLAGS.filter(flag => entry[flag] === true).join(\",\"), JSON.stringify(requires.map(([name]) => name))]", "TREE_FLAGS.filter(flag => entry[flag] === true).join(\",\"), JSON.stringify(requires)]", C],
  ["lock views: devOptional and peer not compared between the views", J, "const TREE_FLAGS = [\"dev\", \"optional\", \"devOptional\", \"peer\", \"bundled\"];", "const TREE_FLAGS = [\"dev\", \"optional\", \"bundled\"];", JT],
  ["requirements: an overridden copy taken by the requirement's own range (B2)", J, "overridden.length ? overridden.some(s => takes(found, name, s)) : takes(found, name, spec)", "takes(found, name, spec) || overridden.some(s => takes(found, name, s))", C],
  ["requirements: a tree alias read under its path's name (M18, N4)", J, ": alias ? alias[1]! : name,", ": name,", JT],
  ["requirements: an override key counting for every name (M22, N4)", J, "if (rule.name === name && takes(rule.selector, range => semver.validRange", "if (takes(rule.selector, range => semver.validRange", JT],
  ["npm: a moved entry's peerDependenciesMeta not compared with the registry (N1)", D, "for (const key of [\"requires\", \"peers\", \"peersMeta\", \"os\", \"cpu\", \"libc\"] as const) {", "for (const key of [\"requires\", \"peers\", \"os\", \"cpu\", \"libc\"] as const) {", T],
  // The identity rule and the alias locks npm writes (docs/decisions/2026-10-31-lock-corpus-alias.md).
  ["requirements: another package at a location accepted, against the corpus's V3", J, "return found.name === wanted && semver.satisfies", "return semver.satisfies", C],
  ["requirements: an alias read under its location's name, against the corpus's alias locks", J, "const [wanted, range] = alias ? [alias[1]!, alias[2]!] : [name, spec];", "const [wanted, range] = alias ? [name, alias[2]!] : [name, spec];", C],
  // An unplanned entry may differ from the base in its flags only (docs/decisions/2026-10-31-lock-flags-only.md; review 6538813186, B1).
  ["npm: an unplanned entry's flags compared with the base's again (B1)", D, "if (!sameButFlags(before, after)) return `package-lock.json changes", "if (!isDeepStrictEqual(before, after)) return `package-lock.json changes", T],
  ["npm: an unplanned entry's other keys not compared when its flags change", D, "&& isDeepStrictEqual(rest(before), rest(after));", "&& true;", T],
  ["npm: a flag that is not true accepted", D, "NPM_FLAGS.every(flag => !Object.hasOwn(after, flag) || after[flag] === true) && ", "", T],
  ["npm: inBundle counted as a flag", D, "const NPM_FLAGS = [\"dev\", \"optional\", \"devOptional\", \"peer\"];", "const NPM_FLAGS = [\"dev\", \"optional\", \"devOptional\", \"peer\", \"inBundle\"];", T],
  ["npm: an entry whose flags alone changed compared with the registry again", D, "isObject(was[path]) && sameButFlags(was[path], item)) continue;", "isDeepStrictEqual(was[path], item)) continue;", T],
];
// MUTATE_FROM=n runs only the mutations from the n-th on (a later round's new ones); the others are not counted.
const FROM = Number(process.env.MUTATE_FROM ?? 1);
/** "pass", "fail", or "timeout" when the run does not end within LIMIT; then its whole process group is killed. */
const vitest = file => new Promise(resolve => {
  const child = spawn("npx", ["vitest", "run", "--project", "node", "--maxWorkers=2", file], { stdio: "ignore", detached: true, env: { ...process.env, NO_COLOR: "1" } });
  const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} resolve("timeout"); }, LIMIT);
  child.on("exit", code => { clearTimeout(timer); resolve(code === 0 ? "pass" : "fail"); });
});
// MUTATE_RESULTS names a file (on the host, through a mount) that gets one line per finished mutation, written as soon
// as it ends: commit, result, seconds, name. Run again at the same commit (LB_HEAD), a mutation already in it is not run
// again; its recorded result counts (a run that stopped halfway goes on where it stopped).
const RESULTS = process.env.MUTATE_RESULTS, HEAD = process.env.LB_HEAD ?? "unknown";
const done = new Map();
if (RESULTS && existsSync(RESULTS)) for (const line of readFileSync(RESULTS, "utf8").split("\n")) {
  const [head, result, seconds, name] = line.split("\t");
  if (head === HEAD && name) done.set(name, { result, seconds });
}
let caught = 0, timedOut = 0;
// MUTATE_ONLY=27,30 runs only those (one whose text a later round changed, run again on its own).
const ONLY = process.env.MUTATE_ONLY ? new Set(process.env.MUTATE_ONLY.split(",").map(Number)) : null;
const run = [...mutations.entries()].filter(([i]) => i + 1 >= FROM && (!ONLY || ONLY.has(i + 1)));
for (const [i, [name, file, from, to, test]] of run) {
  const original = readFileSync(file, "utf8");
  if (original.split(from).length !== 2) { console.log(`${i + 1}. NOT APPLIED  ${name} (the text is not found exactly once)`); continue; }
  const earlier = done.get(name);
  let result, seconds;
  if (earlier) ({ result, seconds } = earlier);
  else {
    writeFileSync(file, original.replace(from, to));
    const started = Date.now();
    result = await vitest(test);
    writeFileSync(file, original);
    seconds = Math.round((Date.now() - started) / 1000);
    if (RESULTS) appendFileSync(RESULTS, `${HEAD}\t${result}\t${seconds}\t${name}\n`);
  }
  if (result !== "pass") caught++;
  if (result === "timeout") timedOut++;
  const label = { fail: "caught", timeout: `caught: no end within ${LIMIT / 1000} s`, pass: "NOT CAUGHT" }[result];
  console.log(`${i + 1}. ${label}  ${name} — ${test} (${seconds} s${earlier ? ", recorded by an earlier run" : ""})`);
}
const clean = [];
for (const t of new Set(run.map(([, m]) => m[4]))) clean.push(`${t} ${await vitest(t)}`);
// A test file that fails without mutations makes every "caught" of this run worthless: at 0059cb3 the container hit
// its memory limit (a tmpfs /tmp counts against it) and from mutation 72 on every run was killed in 1 s.
if (clean.some(line => !line.endsWith(" pass"))) { console.log("RUN VOID: a test file fails without mutations, so no result of this run counts."); process.exitCode = 1; }
console.log(`${caught} of ${run.length} caught (of ${mutations.length}: ${ONLY ? `only ${[...ONLY].join(", ")}` : `${FROM} to ${mutations.length}`}), ${timedOut} of them by the time limit; without mutations: ${clean.join(", ")}`);
