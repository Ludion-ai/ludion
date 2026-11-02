// Run once before the definition was written, inside the container only. Reads one GH Archive hour as a stream and prints
// which fields it has and how the repository ids run. It keeps nothing, prints no repository name and sends no HEAD request.
// usage: node probe-schema.mjs <YYYY-MM-DD-H>
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

const hour = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}-\d{1,2}$/.test(hour)) throw new Error("hour");
const res = await fetch(`https://data.gharchive.org/${hour}.json.gz`);
console.log(JSON.stringify({ hour, status: res.status, bytes: res.headers.get("content-length") }));
if (!res.ok) process.exit(1);

const types = new Map();
const paths = new Map();
const branchFields = new Map();
const created = [];
const refs = { main: 0, master: 0, otherBranch: 0, notBranch: 0 };
let lines = 0, bad = 0, notPublic = 0;

function walk(obj, prefix, type, depth) {
  if (obj === null || typeof obj !== "object" || depth > 5) return;
  for (const [k, v] of Object.entries(obj)) {
    const path = `${prefix}.${k}`;
    if (/default_branch|master_branch/.test(k) && typeof v === "string") {
      const key = `${type}${path}`;
      branchFields.set(key, (branchFields.get(key) ?? 0) + 1);
    }
    if (Array.isArray(v)) continue;
    walk(v, path, type, depth + 1);
  }
}

const rl = createInterface({ input: Readable.fromWeb(res.body).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of rl) {
  lines++;
  let e;
  try { e = JSON.parse(line); } catch { bad++; continue; }
  types.set(e.type, (types.get(e.type) ?? 0) + 1);
  if (e.public !== true) notPublic++;
  walk(e.payload, "payload", e.type, 0);
  if (e.type === "PushEvent") {
    if ((types.get("PushEvent") ?? 0) <= 2000) for (const k of Object.keys(e.payload ?? {})) paths.set(k, (paths.get(k) ?? 0) + 1);
    const ref = String(e.payload?.ref ?? "");
    if (ref === "refs/heads/main") refs.main++;
    else if (ref === "refs/heads/master") refs.master++;
    else if (ref.startsWith("refs/heads/")) refs.otherBranch++;
    else refs.notBranch++;
  }
  if (e.type === "CreateEvent" && e.payload?.ref_type === "repository") created.push({ id: e.repo.id, at: e.created_at });
}
created.sort((a, b) => a.id - b.id);
const q = f => created[Math.floor((created.length - 1) * f)];
console.log(JSON.stringify({
  lines, bad, notPublic,
  types: Object.fromEntries([...types].sort((a, b) => b[1] - a[1])),
  pushPayloadKeysInFirst2000: Object.fromEntries(paths),
  pushRefs: refs,
  fieldsNamingADefaultBranch: Object.fromEntries([...branchFields].sort((a, b) => b[1] - a[1])),
  repositoryCreateEvents: { n: created.length, min: q(0), p01: q(0.01), median: q(0.5), p99: q(0.99), max: q(1), earliestAt: created.map(c => c.at).sort()[0], latestAt: created.map(c => c.at).sort().at(-1) },
}, null, 1));
