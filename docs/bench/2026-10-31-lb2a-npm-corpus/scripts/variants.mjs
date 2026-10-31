// Runs in Docker only (node, no network): from each lock npm wrote under /out/<npm>/v<n>/<shape>/, writes the variants
// of docs/decisions/2026-10-31-lock-corpus-against-npm.md under <shape>/variants/<V>/, each a copy of the project with
// one change in its package-lock.json, made alike in `packages` and in a v2 lock's npm 6 `dependencies` tree.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = "/out";
const isObject = v => !!v && typeof v === "object" && !Array.isArray(v);
const requireName = path => path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);

/** The tree entry and its parent level for an install path, or null: the same reading as judge.ts's viewOfTree. */
function treeIndex(lock) {
  const index = new Map();
  const walk = (level, prefix) => {
    for (const [name, entry] of Object.entries(level ?? {})) {
      const path = `${prefix}node_modules/${name}`;
      index.set(path, { level, name, entry });
      const linked = lock.packages[path]?.link ? lock.packages[path].resolved : null;
      if (entry.dependencies) walk(entry.dependencies, linked ? `${linked}/` : `${path}/`);
    }
  };
  if (isObject(lock.dependencies)) walk(lock.dependencies, "");
  return index;
}

/** Every [requirer path, name, spec] in `packages` (installed entries' dependencies and optional ones; the project's own). */
function requirements(lock) {
  const out = [];
  for (const [path, item] of Object.entries(lock.packages)) {
    if (!isObject(item) || item.link) continue;
    const groups = path === "" || !path.includes("node_modules/") ? ["dependencies", "optionalDependencies", "devDependencies"] : ["dependencies", "optionalDependencies"];
    for (const group of groups) for (const [name, spec] of Object.entries(item[group] ?? {})) out.push([path, name, spec]);
  }
  return out;
}

const installed = lock => Object.keys(lock.packages).filter(path => path.includes("node_modules/") && isObject(lock.packages[path]) && !lock.packages[path].link).sort();

function variants(lock, manifest) {
  const result = { V0: () => {} };
  const required = new Set(requirements(lock).map(([, name]) => name));
  const ranged = new Set(requirements(lock).filter(([, , spec]) => /^[\^~<>=\d*]/.test(spec)).map(([, name]) => name));
  const pick = test => installed(lock).find(test);
  const v1 = pick(path => required.has(requireName(path)));
  if (v1) result.V1 = (l, t) => { delete l.packages[v1]; const e = t.get(v1); if (e) delete e.level[e.name]; };
  const v2 = pick(path => ranged.has(requireName(path)) && !lock.packages[path].name);
  if (v2) result.V2 = (l, t) => { l.packages[v2].version = "99.0.0"; const e = t.get(v2); if (e) e.entry.version = "99.0.0"; };
  const v3 = pick(path => required.has(requireName(path)) && !lock.packages[path].name);
  if (v3) result.V3 = (l, t) => { l.packages[v3].name = "left-pad"; const e = t.get(v3); if (e) e.entry.version = `npm:left-pad@${e.entry.version}`; };
  const v4 = pick(path => lock.packages[path].peer === true);
  if (v4) result.V4 = (l, t) => { delete l.packages[v4]; const e = t.get(v4); if (e) delete e.level[e.name]; };
  if (isObject(manifest.overrides)) {
    const v5 = pick(path => requireName(path) === "minimist" && lock.packages[path].version === "1.2.5");
    if (v5) result.V5 = (l, t) => { l.packages[v5].version = "1.2.6"; const e = t.get(v5); if (e) e.entry.version = "1.2.6"; };
  }
  return { result, picked: { V1: v1 ?? null, V2: v2 ?? null, V3: v3 ?? null, V4: v4 ?? null } };
}

const manifestOut = [];
for (const npm of readdirSync(out).filter(n => /^\d/.test(n)).sort()) for (const v of readdirSync(join(out, npm)).sort()) for (const shape of readdirSync(join(out, npm, v)).sort()) {
  const dir = join(out, npm, v, shape);
  if (!existsSync(join(dir, "package-lock.json"))) { manifestOut.push({ npm, asked: v, shape, written: false }); continue; }
  const text = readFileSync(join(dir, "package-lock.json"), "utf8"), manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const base = JSON.parse(text);
  const { result, picked } = variants(base, manifest);
  rmSync(join(dir, "variants"), { recursive: true, force: true });
  for (const [name, change] of Object.entries(result)) {
    const target = join(dir, "variants", name);
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(dir)) if (!["variants", "package-lock.json", "npm.log", "npm.exit"].includes(entry) && !/^ls[-.]/.test(entry)) cpSync(join(dir, entry), join(target, entry), { recursive: true });
    const lock = JSON.parse(text);
    change(lock, treeIndex(lock));
    writeFileSync(join(target, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  }
  manifestOut.push({ npm, asked: v, shape, written: true, lockfileVersion: base.lockfileVersion, variants: Object.keys(result), picked });
}
writeFileSync(join(out, "corpus.json"), `${JSON.stringify(manifestOut, null, 2)}\n`);
console.log(`${manifestOut.filter(m => m.written).length} locks, ${manifestOut.filter(m => m.written).reduce((n, m) => n + m.variants.length, 0)} variants (V0 included), ${manifestOut.filter(m => !m.written).length} not written`);
