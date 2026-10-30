# 2026-10-31 (LB2a, #215) — A package-lock.json requirement that the lock leaves unmet is refused only when the change makes it so, and the project's `overrides` count

Committed before the code that follows it. It changes what `readLock` (judge.ts), and so `ludion judge`, npm `patch`'s judge and the PR job (deliver.ts), refuse. It changes no gate's criteria and no wait.

**Why.** LB2a's sixth round (head 2d6f224, merged nowhere yet) made `readLock` refuse any package-lock.json in which a requirement is not found by Node's lookup at a version its range takes. The rule came from a review of #215. That review showed npm `install` fetching, unpinned, a requirement that a forged fix's lock left missing or out of range.

The R lane's review of #215 (comment 6529858505 at 217a6f8, B1) showed that the same rule refuses lockfiles npm 11 writes and main reads:
- a project whose package.json `overrides` pin a version outside a dependent's range (npm installs the override and fetches nothing);
- a lock written with `--legacy-peer-deps` (the peers are left out by design).

For such a project, `ludion judge` threw, every npm `patch` fix stopped at the judge, and the PR job refused the artifact. That narrowed what Ludion does. The decision for #215 is not to narrow it: such lockfiles are read again, with the same protection against a forged change.

**The definition (replaces the sixth round's "every requirement met, or refused").**

1. **Kept as it was (readLock).** A requirement is what a view's entry declares:
   - an entry in `packages`: its `dependencies`, `optionalDependencies`, and the `peerDependencies` its `peerDependenciesMeta` does not mark optional; a link's requirements come from its folder, `devDependencies` included;
   - the project and its folders: their own `dependencies`, `optionalDependencies` and `devDependencies`, and also their `peerDependencies` not marked optional;
   - an entry of the npm 6 `dependencies` tree: its `requires`.

   It is **met** when Node's lookup finds a copy that its spec takes:
   - the named package at a version the semver range takes;
   - for an `npm:` alias, the package the alias names, at a version its range takes;
   - for a `file:` spec, a link.
2. **Overrides (new).** In the `packages` view, which npm 7 and later read, a requirement is also met when the copy found is what the project's own package.json `overrides` give for that name:
   - a top-level key for the name (`name` or `name@range`), whose value is a spec or `{ ".": spec }`, or `"$name"`, meaning the root's own spec for that name;
   - or the same key nested under a package that the requirer is, or is installed under.

   The npm 6 tree gets no such allowance, because npm 6 does not read `overrides`.
3. **Against the base (new).** readLock no longer refuses a lock for an unmet requirement on its own. The callers compare the base (the project as it is, or the change's "before") with the change ("after"):
   - `ludion judge` and npm `patch`'s judge, both through `packageLockInputs`;
   - the PR job's `npmLockProblem`.

   The change is refused when "after" has an unmet requirement that "before" did not have. Each unmet requirement is identified by:
   - for a regular requirement: who requires it (the install path, or the project's or folder's path), the name, the spec, and the copy found (its path, package and version, or none);
   - for a peer: the same, without the spec. A peer that a `--legacy-peer-deps` lock leaves out, by the requirer at the same path, stays the same unmet peer when that requirer moves to a version with another peer range.

   A base that already has unmet requirements (overrides, `--legacy-peer-deps`) is read. A change that adds one is refused, as before. Every form the sixth round refused for a forged fix is a new unmet requirement in "after", so each is still refused:
   - a requirement left out;
   - a copy outside its range;
   - a moved version outside an unmoved dependent's range;
   - the left-pad form.
4. **What is not changed.**
   - The npm 6 tree's closed list of keys, and its agreement with `packages`.
   - The per-path checks of the PR job.
   - The registry comparison of moved and added entries.

**What this still leaves.**
- A project with `--legacy-peer-deps` that the lock records nowhere: npm `install` run without that setting fetches the left-out peers. That is the project's own configuration, at the base as well as in the change.
- An override nested more deeply than one parent is read by name only, under any of the named parents.

**Checked by:** packages/cli/test/judge.test.ts. It reads locks npm 11.19.1 wrote with `overrides` (top-level and nested) and with `--legacy-peer-deps` (fixtures lock-v3-npm11-ovr, -ovr2, -lpd and -lpd2), and refuses each forged form.
