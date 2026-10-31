# 2026-10-31 (LFLAGS) — The PR job computes npm's flags from the lock's graph, and an optional peer adds nothing

**Scope changed on 2026-10-31 (the brain's ludion-ops#1 comment 6542470518, 6, item 4).** Section 1 (optional peers) and its gates P1, N1 and N2 are in #240. Section 2 (the flags computed from the lock's graph) and its gates F1 to F3 are not: a separate lane builds them, starting from this text. #240 was first built with section 2 too; the code was taken out at the narrowing, and F1's result at 39ee847 is kept in docs/bench/2026-10-31-lflags/README.md for that lane. In its place #240 builds gate 2's checks of every entry whose flags alone changed (docs/decisions/2026-10-31-flag-only-entries-gate2.md).

Committed before the npm runs, the tests and the code that follow it. It carries out the "next step" of docs/decisions/2026-10-31-lock-flags-only.md, section 2 (the brain's ludion-ops#1 comment 6539200199, item 1), audit 6541743253's item 1 (an optional peer's location) and item 4 (review 6541119866's N1 and N2). It changes no gate's criteria and no wait.

## 1. An optional peer adds nothing, and is checked where it is there

**The hole (audit 6541743253, item 1, run in Docker on main 355a91c).** In `npmLockProblem` (deliver.ts), an added path counts as required when a moved or added path reaches it through any of `dependencies`, `optionalDependencies` or `peerDependencies` (judge.ts, `DECLARED`), so an optional peer (`peerDependenciesMeta` says `optional: true`) counts too. The requirement check (judge.ts, `requirementsMet`, through `requiredPeers`) leaves optional peers out. So at an optional peer's location nothing checked that the package there is the one the spec names, or that its version is in the range: with node-fetch 2.6.1 -> 2.6.7 (peer `encoding ^0.1.0`, optional), an added `evil-pkg@1.0.0` at node_modules/node-fetch/node_modules/encoding or at node_modules/encoding, and a real `encoding@9.9.9`, all passed `contentProblem`.

**What npm does (npm 12.2.1's own code, read in its image: @npmcli/arborist lib/calc-dep-flags.js).** "only optional peer dependencies should stay extraneous": a package reached only through optional peer edges stays extraneous, and npm prunes extraneous packages from the tree it writes. An optional peer edge that finds a package is still an edge, and `npm ls` checks it. Whether npm 12.2.1 writes a fix whose optional peer finds another package or a version outside the range is run below (X4) before it is relied on.

**The rules taken (the audit's proposals 1 and 2).**
- **(1) Taken.** In the PR job's walk of what the moved and added paths require, an optional peer is not followed. An added path that is reached only through optional peers is stray and refuses the artifact. npm 12.2.1 does not add such a package.
- **(2) Taken, unless X4 below shows npm takes what it refuses.** In the requirement check (judge.ts, `requirementsMet`, used by `ludion judge`, npm `patch`'s judge and the PR job), an optional peer that Node's lookup finds must be the package its spec names, at a version its range takes, as a required peer must; an optional peer that finds nothing is met. As every requirement, it is compared with the base (newUnmetRequirements), so one the base already leaves unmet is the project's own.
  - **Fallback, fixed now:** if npm 12.2.1 writes X4's fix with exit 0 and npm 12.2.1's `npm ls` on it reports no new `missing:` or `invalid:`, rule (2) is not taken (it would refuse a fix npm takes); rule (1) stays, the docs say that a present optional peer is not checked, and this is reported.
- **(3) Tests:** the audit's B, C and E in deliver.test.ts, the optional peer's V3 among the fixtures, each check with at least one mutation that its tests catch. **(4)** docs/mistakes gets the record of this hole in the same PR.

## 2. The flags, computed from the lock's graph

**The rule.** The PR job computes, from the fix's package-lock.json `packages` section, the flags npm 12.2.1 would write on each entry (`dev`, `optional`, `devOptional`, `peer`, and `extraneous`), and from the base's lock the same way. Then every install path of the fix (not a link) that
- the fix moves (planned) or adds, or
- the fix changes in its flags only (docs/decisions/2026-10-31-lock-flags-only.md), or
- whose computed flags differ between the base's lock and the fix's lock

must carry in the fix exactly the flags computed for it. Any other entry is not checked: its flags, as its content, are the base's, and its place in the graph did not change them (so a lock an older npm wrote, whose flags may differ from npm 12.2.1's reading, stops nothing that the fix does not touch). npm 12.2.1 recomputes every flag of a tree it changes (build-ideal-tree.js, `#fixDepFlags`), and `patch` writes every candidate with it, without the project's .npmrc, so a fix npm wrote meets this rule wherever the computation is npm's.

**The computation (calc-dep-flags.js, node.js `_loadDeps`, edge.js and shrinkwrap.js of npm 12.2.1's arborist).**
- Nodes: the root (""), every install path, every folder (workspace or local package) and every link, from `packages`. The root starts with every flag false; every other node with every flag true.
- Edges out of a node, by name, each name once; a later group replaces an earlier one: `peerDependencies` (type peer, or peerOptional where `peerDependenciesMeta` says optional), `dependencies` (prod), `optionalDependencies` (optional), and, for the root and folders only, `devDependencies` (dev). The root has a workspace edge (no flag), which no group replaces, to each link at node_modules/<name> whose target is a folder its `workspaces` names. Each edge goes where Node's lookup finds the name from the node (resolveFrom); one that finds nothing does nothing.
- An edge is dev if dev, optional if optional or peerOptional, peer if peer or peerOptional. From the root, a node passes on: not dev (unless it or the edge is dev), not optional (unless it or the edge is optional), not peer (unless it or the edge is peer), not devOptional (only when it and the edge are neither dev, optional nor devOptional), and not extraneous (unless it is extraneous or the edge is a peerOptional one). A node that is not extraneous makes each extraneous node it is installed under not extraneous. A link passes its flags to its target. Repeated until nothing changes.
- Written as npm writes them: `extraneous` alone when extraneous; else `peer`, `dev`, `optional` where true, and `devOptional` where true and neither `dev` nor `optional` is.

**What remains open.** A flag-only change that npm's graph gives still passes without gate 2's checks of that entry (docs/decisions/2026-10-31-lock-flags-only.md, section 4: OSV's MAL- records and advisories, the registry's deprecation and withdrawal on every entry whose flags alone changed). This lane does not build that; docs/status.md keeps it among what is not built. A package that the base locks for development only can still reach a production install where the fix's graph makes it a production dependency, as npm itself does.

## 3. The npm runs and the forged variants

In Docker only, in the image of fixtures/npm-corpus/npm-12.2.1.Dockerfile (npm 12.2.1) and the corpus's npm 11.19.1 image, as docs/bench/2026-10-31-lb2a-npm-corpus did, with `--cap-drop ALL`, `--user node`, `--memory 2g` and no credentials. Scripts and logs in docs/bench/2026-10-31-lflags/; fixtures under packages/cli/test/fixtures/npm-corpus/extra/.

With the network (the public registry's manifests only), npm 12.2.1, lockfileVersion 2 and 3, the base from the project's package.json, then the fix from the base's lock with node-fetch at 2.6.7, with dependency-patch.ts's npm flags (twice, as `patch` runs it):
- **X1 (optional):** `dependencies` node-fetch 2.6.1, `optionalDependencies` whatwg-url 5.0.0.
- **X2 (peer):** `dependencies` node-fetch 2.6.1, `peerDependencies` whatwg-url 5.0.0.
- **X4 (an optional peer that finds another package):** `dependencies` node-fetch 2.6.1 and `"encoding": "npm:left-pad@1.3.0"`.
- **X5 (an optional peer that finds its package, in range):** `dependencies` node-fetch 2.6.1 and encoding 0.1.13.

With `--network none`, made by a script from npm's own node-fetch fix locks (extra/node-fetch, v2 and v3), each change alike in `packages` and in a v2 lock's npm 6 tree:
- **B:** `evil-pkg@1.0.0` (an alias entry, `name: "evil-pkg"`) added at node_modules/node-fetch/node_modules/encoding.
- **C:** the same at node_modules/encoding.
- **E:** `encoding@9.9.9` added at node_modules/encoding (outside `^0.1.0`).
- **P (the optional peer's V3):** `encoding@0.1.13` named `left-pad` (V3's form: in range, another package) added at node_modules/encoding.
- **R:** the real `encoding@0.1.13`, in range, added at node_modules/node-fetch/node_modules/encoding (rule 1 alone refuses it: npm would not add it).

`npm ls --all --package-lock-only --json` by npm 12.2.1 and npm 11.19.1, `--network none`, on every lock above.

## 4. The gates

- **F1 (the computation is npm's):** for every lock npm 12.2.1 wrote in the corpus (fixtures/npm-corpus, extra/ included, and X1, X2, X4, X5), the computed flags are the written ones at every entry that is not a link. For the locks the other npm versions wrote, the entries that differ are reported as they are, per npm version (they stop nothing: section 2).
- **F2 (no narrowing):** `contentProblem` is null on every npm 12.2.1 fix pair: extra/node-fetch v2 and v3, X1, X2 and X5, and X4 unless npm 12.2.1 does not write it or reports a new problem on it.
- **F3 (flags npm would not compute are refused):** on the node-fetch pair, a flag-only change npm's graph does not give (tr46 given `dev` and `devOptional`; webidl-conversions given `optional`; `peer` added; a dev-only entry's `dev` dropped where the fix does not reach it; `dev` kept on an entry the fix makes a production dependency), each refused.
- **P1 (the optional peer):** B, C, E, P and R refused, in v2 and v3; npm's report on each is recorded and does not change the expected answer, as for V3.
- **N1 and N2 (review 6541119866):** X1 and X2 are taken, so removing `optional` or `peer` from the flag list fails a test; a changed `name` on an unplanned entry is refused, in the test list of forged changes.
- **Mutations:** each new check (rule 1, rule 2, each step of the computation, the choice of checked entries, N1, N2) has at least one mutation, each run in Docker with `--network none`; a mutation its tests do not catch is reported, not dropped.

**When a gate fails:** the result is reported as it is; these definitions and gates are not loosened after seeing it.
