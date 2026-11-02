// Inside the container only. Builds the population of docs/decisions/2026-11-02-lockfile-one-day-definition.md, section 2, from
// the 24 GH Archive files of one UTC day, read as streams and not kept. Sends no request to GitHub.
// usage: node population.mjs <YYYY-MM-DD> <boundary id> <seed> <folder for the order files> <summary file>
import { createHash } from "node:crypto";
import { createWriteStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

const [day, boundaryText, seed, popDir, summaryFile] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "") || !/^\d+$/.test(boundaryText ?? "") || !seed || !popDir || !summaryFile) throw new Error("usage");
const boundary = Number(boundaryText);
const NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const hours = [];
const pushed = new Map(); // repo id -> { name, at, refs:Set }
const defaults = new Map(); // repo id -> { branch, at }
const count = { pushEvents: 0, notPublic: 0, notABranch: 0, nameNotUsable: 0 };

function noteDefault(id, branch, at) {
  const d = defaults.get(id);
  if (!d || String(at) >= d.at) defaults.set(id, { branch, at: String(at) });
}

function readLine(line, h) {
  h.lines++;
  let e;
  try { e = JSON.parse(line); } catch { h.bad++; return; }
  if (e.type === "CreateEvent") {
    h.create++;
    const branch = e.payload?.master_branch;
    if (typeof branch === "string" && branch && Number.isInteger(e.repo?.id)) noteDefault(e.repo.id, branch, e.created_at);
  } else if (e.type === "ForkEvent") {
    h.fork++;
    const f = e.payload?.forkee;
    if (Number.isInteger(f?.id) && typeof f.default_branch === "string" && f.default_branch) noteDefault(f.id, f.default_branch, e.created_at);
  } else if (e.type === "PushEvent") {
    h.push++;
    count.pushEvents++;
    if (e.public !== true) { count.notPublic++; return; }
    const ref = e.payload?.ref;
    if (typeof ref !== "string" || !ref.startsWith("refs/heads/")) { count.notABranch++; return; }
    if (!Number.isInteger(e.repo?.id) || !NAME.test(String(e.repo?.name))) { count.nameNotUsable++; return; }
    const at = String(e.created_at);
    let r = pushed.get(e.repo.id);
    if (!r) pushed.set(e.repo.id, (r = { name: e.repo.name, at, refs: new Set() }));
    else if (at >= r.at) { r.name = e.repo.name; r.at = at; }
    r.refs.add(ref.slice("refs/heads/".length));
  }
}

/** One whole file or nothing: a file that fails is read again from its start, at most 3 times, and then the run stops. */
async function readHour(hour) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const lines = [];
    try {
      const res = await fetch(`https://data.gharchive.org/${day}-${hour}.json.gz`, { signal: AbortSignal.timeout(600_000) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const rl = createInterface({ input: Readable.fromWeb(res.body).pipe(createGunzip()), crlfDelay: Infinity });
      for await (const line of rl) lines.push(line);
      const h = { hour, bytes: Number(res.headers.get("content-length")), attempt, lines: 0, bad: 0, push: 0, create: 0, fork: 0 };
      for (const line of lines) readLine(line, h);
      return h;
    } catch (err) {
      lastError = err;
      console.error(`hour ${hour} attempt ${attempt}: ${err}`);
    }
  }
  throw new Error(`hour ${hour}: ${lastError}`);
}

for (let hour = 0; hour < 24; hour++) {
  const h = await readHour(hour);
  hours.push(h);
  console.log(JSON.stringify(h));
}

const strata = { new: [], old: [] };
const excluded = { knownDefaultNotPushed: 0, defaultNotKnownAndNotMainOrMaster: 0 };
const how = { knownDefault: 0, assumedMainOrMaster: 0 };
for (const [id, r] of pushed) {
  const known = defaults.get(id)?.branch;
  let way;
  if (known !== undefined) {
    if (!r.refs.has(known)) { excluded.knownDefaultNotPushed++; continue; }
    way = "knownDefault";
  } else {
    if (!r.refs.has("main") && !r.refs.has("master")) { excluded.defaultNotKnownAndNotMainOrMaster++; continue; }
    way = "assumedMainOrMaster";
  }
  how[way]++;
  strata[id >= boundary ? "new" : "old"].push({ id, name: r.name, way, key: createHash("sha256").update(`${seed}:${id}`).digest("hex") });
}

const sizes = {};
for (const [stratum, rows] of Object.entries(strata)) {
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  sizes[stratum] = rows.length;
  const out = createWriteStream(`${popDir}/order-${stratum}.tsv`);
  rows.forEach((r, i) => out.write(`${i}\t${r.id}\t${r.name}\t${r.way}\n`));
  await new Promise(resolve => out.end(resolve));
}

writeFileSync(summaryFile, JSON.stringify({ day, boundary, seed, count, distinctPushedRepositories: pushed.size, repositoriesWithAKnownDefault: defaults.size, excluded, how, strata: sizes, hours }, null, 1) + "\n");
console.log(JSON.stringify({ count, distinct: pushed.size, excluded, how, sizes }));
