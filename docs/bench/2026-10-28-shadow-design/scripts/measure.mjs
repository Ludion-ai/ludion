// Measurement for the shadow design's estimates (docs/bench/2026-10-28-shadow-design/README.md, "Measured inputs").
// Reads public data only: the 100 noise repositories' root package-lock.json at their recorded SHAs, this
// repository's root lockfile, a fixed sample of full packuments, their attestations, OSV (package names only) and
// the root of the npm replication feed. Runs no project code. Run in Docker:
//   docker run --rm --read-only --user 1000:1000 --tmpfs /tmp -e DOGFOOD_SHA=<main's sha> -v "$PWD:/repo:ro" \
//     -v "$PWD/docs/bench:/bench:ro" -v "$PWD/docs/bench/2026-10-28-shadow-design/out:/out" node:24-slim \
//     node /bench/2026-10-28-shadow-design/scripts/measure.mjs /repo/package-lock.json
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const WINDOW_START = "2026-09-30T00:00:00.000Z", WINDOW_END = "2026-10-28T00:00:00.000Z", WINDOW_DAYS = 28;
const SAMPLE = 300, ATTESTATION_CAP = 200, CONCURRENCY = 8;
const log = (...a) => console.error(new Date().toISOString(), ...a);

async function get(url, init = {}, max = 64 * 1024 * 1024) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000), ...init, headers: { "user-agent": "Ludion-shadow-measure", ...(init.headers ?? {}) } });
      if (res.status === 404) return { status: 404 };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > max) throw new Error(`body over ${max}`);
      return { status: res.status, bytes: buf.length, text: buf.toString("utf8") };
    } catch (e) {
      if (attempt === 3) return { status: "error", error: String(e.message ?? e) };
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}
async function pool(items, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}
const nameOf = (path, entry) => entry.name ?? path.slice(path.lastIndexOf("node_modules/") + 13);
function entries(lock) {
  const out = [];
  for (const [path, e] of Object.entries(lock.packages ?? {})) {
    if (!path.includes("node_modules/") || e.link || typeof e.version !== "string") continue;
    out.push({ name: nameOf(path, e), version: e.version, registry: typeof e.resolved === "string" && e.resolved.startsWith("https://registry.npmjs.org/") });
  }
  return out;
}
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const sum = xs => xs.reduce((a, b) => a + b, 0);

const replicateStart = { at: new Date().toISOString(), body: (await get("https://replicate.npmjs.com/")).text };

// 1. The watched set: lockfiles.
const noise = JSON.parse(readFileSync("/bench/2026-10-28-noise/noise.json", "utf8"));
const sources = noise.rows.map(r => ({ source: r.repo, sha: r.sha, url: `https://raw.githubusercontent.com/${r.repo}/${r.sha}/package-lock.json` }));
const lockfiles = await pool(sources, async s => {
  const r = await get(s.url);
  if (r.status !== 200) return { ...s, error: r.error ?? r.status };
  return { ...s, bytes: r.bytes, entries: entries(JSON.parse(r.text)) };
});
const dogfood = { source: "Ludion-ai/ludion (dogfood)", sha: process.env.DOGFOOD_SHA ?? null, entries: entries(JSON.parse(readFileSync(process.argv[2], "utf8"))) };
const all = [dogfood, ...lockfiles];
const names = new Set(), versions = new Set(), nonRegistry = new Set();
for (const l of all) for (const e of l.entries ?? []) { names.add(e.name); versions.add(`${e.name}@${e.version}`); if (!e.registry) nonRegistry.add(`${e.name}@${e.version}`); }
log("lockfiles", all.length, "failed", lockfiles.filter(l => l.error).length, "names", names.size, "versions", versions.size);

// 2. A fixed sample of names: the SAMPLE lowest sha256(name).
const sorted = [...names].map(n => ({ n, h: createHash("sha256").update(n).digest("hex") })).sort((a, b) => a.h < b.h ? -1 : 1);
const sample = sorted.slice(0, SAMPLE).map(x => x.n);
const regPath = n => n.startsWith("@") ? `@${encodeURIComponent(n.slice(1))}` : encodeURIComponent(n);
const recent = [];
const packuments = await pool(sample, async name => {
  const r = await get(`https://registry.npmjs.org/${regPath(name)}`);
  if (r.status !== 200) return { name, error: r.error ?? r.status };
  const doc = JSON.parse(r.text);
  let inWindow = 0;
  for (const [v, t] of Object.entries(doc.time ?? {})) {
    if (v === "created" || v === "modified" || !(t >= WINDOW_START && t < WINDOW_END)) continue;
    inWindow++;
    const m = doc.versions?.[v];
    recent.push({ name, version: v, published: t, present: !!m, manifest_bytes: m ? Buffer.byteLength(JSON.stringify(m)) : null, attestations: !!m?.dist?.attestations, install_scripts: m ? ["preinstall", "install", "postinstall"].filter(s => typeof m.scripts?.[s] === "string") : [] });
  }
  return { name, packument_bytes: r.bytes, versions: Object.keys(doc.versions ?? {}).length, in_window: inWindow };
});
log("packuments", packuments.filter(p => !p.error).length, "recent versions", recent.length);

// 3. Attestation bundle sizes, for the first ATTESTATION_CAP recent versions that have one (sample order).
const withAtt = recent.filter(r => r.attestations).slice(0, ATTESTATION_CAP);
const attSizes = (await pool(withAtt, async r => (await get(`https://registry.npmjs.org/-/npm/v1/attestations/${regPath(r.name)}@${encodeURIComponent(r.version)}`, {}, 8 * 1024 * 1024)).bytes ?? null)).filter(x => x != null);

// 4. OSV MAL- records naming a watched package (names only, querybatch), and when each was published.
const nameList = [...names];
const malIds = new Set(); let truncated = 0, osvErrors = 0;
for (let i = 0; i < nameList.length; i += 100) {
  const r = await get("https://api.osv.dev/v1/querybatch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queries: nameList.slice(i, i + 100).map(name => ({ package: { ecosystem: "npm", name } })) }) });
  if (r.status !== 200) { osvErrors++; continue; }
  for (const res of JSON.parse(r.text).results ?? []) { if (res.next_page_token) truncated++; for (const v of res.vulns ?? []) if (v.id.startsWith("MAL-")) malIds.add(v.id); }
}
const malRecords = await pool([...malIds], async id => {
  const r = await get(`https://api.osv.dev/v1/vulns/${id}`);
  if (r.status !== 200) return { id, error: r.error ?? r.status };
  const v = JSON.parse(r.text);
  return { id, published: v.published, modified: v.modified, withdrawn: v.withdrawn ?? null, packages: (v.affected ?? []).map(a => a.package?.name), versions: (v.affected ?? []).flatMap(a => a.versions ?? []).slice(0, 20) };
});

// 5. OSV's npm modified_id.csv: MAL- lines modified within the window (registry-wide).
const csv = (await get("https://osv-vulnerabilities.storage.googleapis.com/npm/modified_id.csv")).text ?? "";
const csvLines = csv.split("\n").filter(Boolean).map(l => { const [t, id] = l.split(","); return { t, id }; });
const malCsv = csvLines.filter(l => l.id?.startsWith("MAL-"));

const replicateEnd = { at: new Date().toISOString(), body: (await get("https://replicate.npmjs.com/")).text };

const ok = packuments.filter(p => !p.error);
const result = {
  measured: { started: replicateStart.at, finished: replicateEnd.at, window: [WINDOW_START, WINDOW_END], node: process.version },
  watched_set: {
    lockfiles: all.length, lockfiles_failed: lockfiles.filter(l => l.error).map(l => ({ source: l.source, error: l.error })),
    lockfile_bytes: sum(lockfiles.filter(l => l.bytes).map(l => l.bytes)),
    distinct_names: names.size, distinct_name_versions: versions.size, non_registry_name_versions: nonRegistry.size,
    dogfood_entries: dogfood.entries.length, sandbox: "Ludion-ai/ludion-sandbox: the repository is empty (HTTP 409 'Git Repository is empty.')",
  },
  sample: {
    names: sample.length, read: ok.length, failed: packuments.filter(p => p.error).map(p => ({ name: p.name, error: p.error })),
    versions_in_window: recent.length, names_with_any_in_window: ok.filter(p => p.in_window > 0).length,
    per_name_per_day: ok.length ? recent.length / ok.length / WINDOW_DAYS : null,
    packument_bytes: { median: median(ok.map(p => p.packument_bytes)), p90: pct(ok.map(p => p.packument_bytes), 0.9), max: Math.max(...ok.map(p => p.packument_bytes)) },
    manifest_bytes: { median: median(recent.filter(r => r.present).map(r => r.manifest_bytes)), p90: pct(recent.filter(r => r.present).map(r => r.manifest_bytes), 0.9), mean: recent.filter(r => r.present).length ? sum(recent.filter(r => r.present).map(r => r.manifest_bytes)) / recent.filter(r => r.present).length : null },
    with_attestations: recent.filter(r => r.attestations).length, with_install_scripts: recent.filter(r => r.install_scripts.length).length, not_listed: recent.filter(r => !r.present).length,
    attestation_bytes: { read: attSizes.length, median: median(attSizes), p90: pct(attSizes, 0.9), mean: attSizes.length ? sum(attSizes) / attSizes.length : null },
    top_publishers_in_window: Object.entries(recent.reduce((m, r) => (m[r.name] = (m[r.name] ?? 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 10),
  },
  osv: {
    watched_names_queried: nameList.length, batch_errors: osvErrors, results_with_more_pages: truncated,
    mal_records_naming_watched: malRecords.length, mal_records: malRecords,
    mal_published_in_window: malRecords.filter(r => r.published >= WINDOW_START && r.published < WINDOW_END).length,
    npm_modified_id_lines: csvLines.length, npm_mal_lines: malCsv.length,
    npm_mal_modified_in_window: malCsv.filter(l => l.t >= WINDOW_START && l.t < WINDOW_END).length,
  },
  replication_root: { start: replicateStart, end: replicateEnd },
};
writeFileSync("/out/measure.json", JSON.stringify(result, null, 2) + "\n");
log("done");
