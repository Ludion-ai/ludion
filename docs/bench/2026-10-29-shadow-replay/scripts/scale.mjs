// A synthetic recorder store at the design's four-week scale (docs/bench/2026-10-28-shadow-design, section 5: about
// 27,100 new versions, manifests about 3.5 KB, attestation bundles about 15 KB on 82%), to check that the replay runs
// within run.sh's memory. Nothing here is registry data: names come from the watched list, everything else is made up.
// Run in Docker with no network, from the repository root:
//   node docs/bench/2026-10-29-shadow-replay/scripts/scale.mjs <out dir> [versions] [names]
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const [out, versionsArg = "27100", namesArg = "2200"] = process.argv.slice(2);
const VERSIONS = Number(versionsArg), NAMES = Number(namesArg);
const T0 = Date.parse("2026-01-05T00:00:00.000Z"), H = 3_600_000, DAYS = 28 + 15;
const iso = t => new Date(t).toISOString();
const watched = Object.keys(JSON.parse(readFileSync("tools/shadow/watched.json", "utf8")).names).slice(0, NAMES);
for (const k of ["captures", "osv", "status"]) mkdirSync(join(out, k), { recursive: true });
const day = t => iso(t).slice(0, 10);
const put = (kind, t, rec) => appendFileSync(join(out, kind, `${day(t)}.jsonl`), JSON.stringify(rec) + "\n");
const integrity = id => `sha512-${createHash("sha512").update(id).digest("base64")}`;
const hex = id => createHash("sha512").update(id).digest("hex");
const filler = n => createHash("sha256").update(String(n)).digest("base64").repeat(Math.ceil(n / 44)).slice(0, n);
const manifest = (name, v) => ({
  name, version: v, description: filler(1500), scripts: { test: "x" }, dependencies: { [watched[(name.length * 7) % watched.length]]: "^1.0.0" },
  _npmUser: { name: "alice" }, maintainers: [{ name: "alice" }], repository: { type: "git", url: `git+https://github.com/x/${name}.git` },
  dist: { tarball: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${v}.tgz`, integrity: integrity(`${name}@${v}`), shasum: "0".repeat(40), unpackedSize: 1000, attestations: { url: "x" } },
});
const attestations = (name, v) => ({ attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: { verificationMaterial: { certificate: filler(12000) }, dsseEnvelope: { payload: Buffer.from(JSON.stringify({ subject: [{ name: `pkg:npm/${name.replace(/^@/, "%40")}@${v}`, digest: { sha512: hex(`${name}@${v}`) } }], predicate: { buildDefinition: { externalParameters: { workflow: { repository: `https://github.com/x/${name}`, path: ".github/workflows/p.yml" } }, resolvedDependencies: [{ digest: { gitCommit: "a".repeat(40) } }] } } })).toString("base64") } } }] });
const version = (name, v, t, reason) => put("captures", t, { type: "version", name, version: v, reason, fetched_at: iso(t), shared_publisher: false, manifest: manifest(name, v), attestations: { url: "x", status: 200, body: attestations(name, v) }, files: { status: "hashed", tarball_bytes: 1000, files: [["package.json", 300, "0".repeat(64)], ["index.js", 700, "1".repeat(64)]] } });

put("status", T0 - 60_000, { type: "start", at: iso(T0 - 60_000), commit: "8a78b55940def8463a2401e7bdd38d7e6c7b604d", watched_sha256: "x" });
for (let t = T0; t < T0 + DAYS * 24 * H; t += 60_000) put("status", t, { type: "poll", at: iso(t), entries: 50, watched: 1 });
for (let d = 0; d < DAYS; d++) put("status", T0 + d * 24 * H + 30_000, { type: "osv", at: iso(T0 + d * 24 * H + 30_000), stored: 0 });
// First sight of each name: a baseline with 40 old versions, and the version the lockfiles hold.
const counter = new Map();
watched.forEach((name, i) => {
  const t = T0 + 5_000 + i * 1000;
  const time = { created: "2020-01-01T00:00:00.000Z" };
  for (let k = 0; k < 40; k++) time[`1.0.${k}`] = iso(Date.parse("2020-01-01T00:00:00.000Z") + k * 24 * H);
  put("captures", t, { type: "baseline", name, fetched_at: iso(t), url: "x", body_sha256: "x", time, dist_tags: { latest: "1.0.39" } });
  version(name, "1.0.39", t + 1, "lockfile");
  counter.set(name, 0);
});
// New versions spread over the four weeks, 1.1.<n> per name, each with its change record and a dependency's `created`.
for (let k = 0; k < VERSIONS; k++) {
  const name = watched[k % watched.length], n = counter.get(name);
  counter.set(name, n + 1);
  const t = T0 + 3 * H + Math.floor((k / VERSIONS) * 28 * 24 * H);
  const v = `1.1.${n}`;
  put("captures", t, { type: "change", name, fetched_at: iso(t + 500), url: "x", body_sha256: "x", dist_tags: null, time: { [v]: iso(t) }, removed: [] });
  version(name, v, t + 600, "new");
  if (k % 10 === 0) put("captures", t, { type: "created", name: `dep-${k}`, fetched_at: iso(t + 700), url: "x", created: "2019-01-01T00:00:00.000Z" });
}
console.log(JSON.stringify({ versions: VERSIONS, names: watched.length, days: DAYS }));
