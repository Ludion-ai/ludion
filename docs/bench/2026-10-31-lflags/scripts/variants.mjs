// Runs in Docker only, with --network none (docs/decisions/2026-10-31-lock-flags-from-graph.md, section 3): the forged
// variants B, C, E, P and R of npm 12.2.1's node-fetch fix locks (fixtures/npm-corpus/extra/node-fetch/v<2|3>/fix),
// each one change made alike in `packages` and in a v2 lock's npm 6 tree. The real encoding 0.1.13, iconv-lite and
// safer-buffer entries come from npm 12.2.1's X5 fix lock (/out/optional-peer-in-range). Output: /out/optional-peer-forged/<V>/v<2|3>/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [inDir, xDir, outDir] = ["/in/extra/node-fetch", "/out/optional-peer-in-range", "/out/optional-peer-forged"];
const FAKE = `sha512-${Buffer.alloc(64, 7).toString("base64")}`;
const tree = (entry) => {
  const out = { version: entry.name ? `npm:${entry.name}@${entry.version}` : entry.version, resolved: entry.resolved, integrity: entry.integrity };
  if (entry.dependencies) out.requires = entry.dependencies;
  return out;
};
for (const v of ["v2", "v3"]) {
  const fix = JSON.parse(readFileSync(`${inDir}/${v}/fix/package-lock.json`, "utf8"));
  const pkg = readFileSync(`${inDir}/${v}/fix/package.json`, "utf8");
  const x5 = JSON.parse(readFileSync(`${xDir}/${v}/fix/package-lock.json`, "utf8")).packages;
  const real = (path) => { const { license, ...rest } = x5[path]; return rest; };
  const evil = { name: "evil-pkg", version: "1.0.0", resolved: "https://registry.npmjs.org/evil-pkg/-/evil-pkg-1.0.0.tgz", integrity: FAKE };
  const variants = {
    // B and C: the audit's evil-pkg, nested under node-fetch and at the top.
    B: { "node_modules/node-fetch/node_modules/encoding": evil },
    C: { "node_modules/encoding": evil },
    // E: the real name outside node-fetch's ^0.1.0.
    E: { "node_modules/encoding": { version: "9.9.9", resolved: "https://registry.npmjs.org/encoding/-/encoding-9.9.9.tgz", integrity: FAKE } },
    // P: V3's form at the optional peer's location: encoding 0.1.13's tarball, in range, filed as left-pad.
    P: { "node_modules/encoding": { name: "left-pad", ...real("node_modules/encoding") }, "node_modules/iconv-lite": real("node_modules/iconv-lite"), "node_modules/safer-buffer": real("node_modules/safer-buffer") },
    // R: the real encoding 0.1.13 and what it requires, nested under node-fetch: in range, but npm does not add it.
    R: { "node_modules/node-fetch/node_modules/encoding": real("node_modules/encoding"), "node_modules/node-fetch/node_modules/iconv-lite": real("node_modules/iconv-lite"), "node_modules/node-fetch/node_modules/safer-buffer": real("node_modules/safer-buffer") },
  };
  for (const [name, added] of Object.entries(variants)) {
    const lock = structuredClone(fix);
    lock.packages = Object.fromEntries(Object.entries({ ...lock.packages, ...added }).sort(([a], [b]) => a === "" ? -1 : b === "" ? 1 : a < b ? -1 : 1));
    if (lock.dependencies) for (const [path, entry] of Object.entries(added)) {
      const parts = path.split("node_modules/").slice(1).map(p => p.replace(/\/$/, ""));
      let level = lock.dependencies;
      for (const part of parts.slice(0, -1)) level = (level[part].dependencies ??= {});
      level[parts.at(-1)] = tree(entry);
    }
    const dir = `${outDir}/${name}/${v}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/package.json`, pkg);
    writeFileSync(`${dir}/package-lock.json`, `${JSON.stringify(lock, null, 2)}\n`);
    console.log(`${name} ${v}: added ${Object.keys(added).join(", ")}`);
  }
}
