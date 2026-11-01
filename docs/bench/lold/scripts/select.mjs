// LOLD: picks the examples from backtest v4's fix rows, by the rule in ../definitions.md, section 5.
// It reads only: the rows, each package's abbreviated packument, and the registry's advisory endpoint for the
// row's version. It runs no resolver, so it sees no result.
// Usage (Docker only): node select.mjs <fixes-v4.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("/vol/npm12/node_modules/npm/package.json");
const semver = require("semver");
const REGISTRY = "https://registry.npmjs.org";
const [rowsPath, outPath] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(rowsPath, "utf8")).rows;
const MAX_TREE = 500, MAIN = 20, PEERS = 2;

const docs = new Map();
async function abbreviated(name) {
  if (docs.has(name)) return docs.get(name);
  const url = `${REGISTRY}/${name.replace("/", "%2f")}`;
  const res = await fetch(url, { headers: { accept: "application/vnd.npm.install-v1+json" } });
  const doc = res.ok ? await res.json() : null;
  docs.set(name, doc);
  return doc;
}

/** The ranges of a manifest that npm installs: dependencies, optional ones, and peers not marked optional. */
function ranges(manifest) {
  const out = { ...manifest.dependencies, ...manifest.optionalDependencies };
  const peers = {};
  for (const [name, spec] of Object.entries(manifest.peerDependencies ?? {})) {
    if (!manifest.peerDependenciesMeta?.[name]?.optional) peers[name] = spec;
  }
  return { deps: out, peers };
}

async function vulnerableRange(row) {
  const res = await fetch(`${REGISTRY}/-/npm/v1/security/advisories/bulk`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ [row.name]: [row.from] }),
  });
  if (!res.ok) return { range: null, read: `HTTP ${res.status}` };
  const body = await res.json();
  const hit = (body[row.name] ?? []).find(a => String(a.url ?? "").endsWith(row.id));
  return { range: hit?.vulnerable_versions ?? null, read: hit ? "advisory endpoint" : "row id not in the answer" };
}

const counts = { rows: rows.length, unreadable: 0, version_gone: 0, new_or_changed_range: 0, of_them_new_or_changed_peer: 0, over_tree_cap: 0 };
const eligible = [];
for (const row of rows) {
  const doc = await abbreviated(row.name);
  if (!doc) { counts.unreadable++; continue; }
  const from = doc.versions?.[row.from], to = doc.versions?.[row.to];
  if (!from || !to) { counts.version_gone++; continue; }
  const a = ranges(from), b = ranges(to);
  const changedDeps = Object.keys(b.deps).filter(n => a.deps[n] !== b.deps[n]);
  const changedPeers = Object.keys(b.peers).filter(n => a.peers[n] !== b.peers[n]);
  if (!changedDeps.length && !changedPeers.length) continue;
  counts.new_or_changed_range++;
  if (changedPeers.length) counts.of_them_new_or_changed_peer++;
  const tree = row.with_exception?.tree_versions ?? 0;
  if (tree > MAX_TREE) { counts.over_tree_cap++; continue; }
  eligible.push({ row, changedDeps, changedPeers, tree });
}

const chosen = [], names = new Set();
const take = (item, why) => {
  names.add(item.row.name);
  chosen.push({ why, item });
};
for (const item of eligible) {
  if (chosen.length >= MAIN) break;
  if (!names.has(item.row.name)) take(item, "first eligible rows, one per package");
}
let peers = 0;
for (const item of eligible) {
  if (peers >= PEERS) break;
  if (item.changedPeers.length && !names.has(item.row.name)) { take(item, "first eligible rows with a new or changed peer range"); peers++; }
}
if (!names.has("next")) {
  const row = eligible.find(item => item.row.name === "next");
  if (row) take(row, "first eligible next row");
}

const examples = [];
for (const [index, { why, item }] of chosen.entries()) {
  const { row, changedDeps, changedPeers, tree } = item;
  const vulnerable = await vulnerableRange(row);
  const fromDoc = await abbreviated(row.name);
  examples.push({
    id: `R${String(index + 1).padStart(2, "0")}`, why, kind: "row", advisory: row.id, name: row.name, from: row.from, v: row.to,
    vulnerable: vulnerable.range ?? `=${row.from}`, vulnerable_read: vulnerable.read,
    fix_published: row.fix_published, advisory_published: row.advisory_published, urgency: row.urgency, tree_versions_v4: tree,
    changed_deps: changedDeps, changed_peers: changedPeers,
    dist_tag_latest_today: fromDoc?.["dist-tags"]?.latest ?? null,
    semver_valid: Boolean(semver.valid(row.to)),
  });
}
writeFileSync(outPath, JSON.stringify({ counts, eligible_after_cap: eligible.length, distinct_eligible_names: new Set(eligible.map(e => e.row.name)).size, examples }, null, 2) + "\n");
console.log(JSON.stringify({ counts, eligible_after_cap: eligible.length, chosen: examples.map(e => `${e.id} ${e.name} ${e.from}->${e.v} tree=${e.tree_versions_v4} peers=${e.changed_peers.length} vuln=${e.vulnerable}`) }, null, 1));
