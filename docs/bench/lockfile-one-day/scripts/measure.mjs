// Inside the container only. Sends HEAD requests to raw.githubusercontent.com as docs/decisions/2026-11-02-lockfile-one-day-definition.md
// says, and a ranged GET for the head of a yarn.lock. No token, no cookie, no redirect followed, nothing cloned, nothing run.
// Every answer goes to the journal, so a run that stopped goes on from where it was. The head of a yarn.lock is read and dropped.
// usage: node measure.mjs <folder of the order files> <journal file> [per-stratum target]
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const [popDir, journalFile, targetText] = process.argv.slice(2);
if (!popDir || !journalFile) throw new Error("usage");
const TARGET = Number(targetText ?? 500);
const WORKERS = 4;
const MIN_GAP_MS = 125; // at most 8 requests a second, all workers together
const DEFAULT_WAIT_MS = 30_000;
const MAX_WAIT_MS = 900_000;
const STOP_AFTER_UNKNOWN_IN_A_ROW = 20;
const HEAD_CAP = 25_000;
const LOCKS = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];
const NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const journal = new Map();
if (existsSync(journalFile)) {
  for (const line of readFileSync(journalFile, "utf8").split("\n")) {
    if (!line) continue;
    const j = JSON.parse(line);
    journal.set(`${j.s}:${j.p}:${j.f}`, j);
  }
}
// The cap counts every HEAD answer the run has had, across restarts.
const headsBefore = [...journal.values()].filter(j => j.f !== "yarn.kind").length;

const stats = { requests: 0, heads: 0, gets: 0, retried: 0, status429: 0, status5xx: 0, networkErrors: 0, unknown: 0, headsBefore };
let unknownInARow = 0;
let nextStart = 0;
let pauseUntil = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function slot() {
  for (;;) {
    const now = Date.now();
    if (now < pauseUntil) { await sleep(pauseUntil - now); continue; }
    if (now >= nextStart) { nextStart = now + MIN_GAP_MS; return; }
    await sleep(nextStart - now);
  }
}

function urlOf(name, file) {
  if (!NAME.test(name)) throw new Error("name");
  const [owner, repo] = name.split("/");
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/HEAD/${file}`;
}

const transient = status => status === "error" || status === 429 || (typeof status === "number" && status >= 500);

function waitOf(res) {
  const header = res?.headers?.get("retry-after");
  const seconds = header && /^\d+$/.test(header) ? Number(header) : null;
  return Math.min(seconds === null ? DEFAULT_WAIT_MS : seconds * 1000, MAX_WAIT_MS);
}

async function once(url, init) {
  await slot();
  stats.requests++;
  if (init.method === "HEAD") stats.heads++; else stats.gets++;
  try {
    const res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    if (res.status === 429) stats.status429++;
    if (res.status >= 500) stats.status5xx++;
    return { status: res.status, res };
  } catch {
    stats.networkErrors++;
    return { status: "error", res: null };
  }
}

/** One try, and one more after a wait when the answer was 429, 5xx or a failed request. */
async function ask(url, init) {
  let a = await once(url, init);
  let tries = 1;
  if (transient(a.status)) {
    await a.res?.body?.cancel();
    const wait = waitOf(a.res);
    if (a.status === 429) pauseUntil = Math.max(pauseUntil, Date.now() + wait);
    stats.retried++;
    await sleep(wait);
    a = await once(url, init);
    tries = 2;
  }
  return { ...a, tries };
}

function settle(status) {
  if (status === 200 || status === 404) { unknownInARow = 0; return; }
  stats.unknown++;
  unknownInARow++;
  if (unknownInARow >= STOP_AFTER_UNKNOWN_IN_A_ROW) {
    console.error(`stopped: ${unknownInARow} unknown answers in a row, last ${status}. ${JSON.stringify(stats)}`);
    process.exit(3);
  }
}

function note(stratum, position, file, fields) {
  const j = { s: stratum, p: position, f: file, ...fields, at: new Date().toISOString() };
  journal.set(`${stratum}:${position}:${file}`, j);
  appendFileSync(journalFile, JSON.stringify(j) + "\n");
  return j;
}

function checkCap() {
  if (stats.heads + stats.headsBefore >= HEAD_CAP) {
    console.error(`stopped: the cap of ${HEAD_CAP} HEAD requests. ${JSON.stringify(stats)}`);
    process.exit(4);
  }
}

async function headOf(stratum, position, name, file) {
  const known = journal.get(`${stratum}:${position}:${file}`);
  if (known) return known;
  checkCap();
  const a = await ask(urlOf(name, file), { method: "HEAD" });
  await a.res?.body?.cancel();
  settle(a.status);
  return note(stratum, position, file, { st: a.status, tries: a.tries });
}

/** Reads at most the first 1,024 bytes, says which of the two formats its lines name, and drops them. */
async function yarnKind(stratum, position, name) {
  const key = `${stratum}:${position}:yarn.kind`;
  if (journal.has(key)) return;
  const a = await ask(urlOf(name, "yarn.lock"), { method: "GET", headers: { range: "bytes=0-1023" } });
  let kind = "unknown";
  if ((a.status === 200 || a.status === 206) && a.res?.body) {
    const reader = a.res.body.getReader();
    const parts = [];
    let got = 0;
    try {
      while (got < 1024) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
      }
      const lines = Buffer.concat(parts).subarray(0, 1024).toString("latin1").split(/\r?\n/);
      if (lines.some(l => l.trim() === "# yarn lockfile v1")) kind = "v1";
      else if (lines.some(l => /^__metadata:\s*$/.test(l))) kind = "berry";
      else kind = "other";
    } catch {
      kind = "unknown";
    }
    await reader.cancel().catch(() => {});
  } else {
    await a.res?.body?.cancel();
  }
  settle(a.status === 206 ? 200 : a.status);
  note(stratum, position, "yarn.kind", { st: a.status, tries: a.tries, kind });
}

async function pool(items, work) {
  let next = 0;
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  }));
}

for (const stratum of ["new", "old"]) {
  const order = readFileSync(`${popDir}/order-${stratum}.tsv`, "utf8").split("\n").filter(Boolean).map(l => {
    const [position, id, name] = l.split("\t");
    return { position: Number(position), id, name };
  });
  // Screening, in the drawn order, four at a time: the sample is the first TARGET repositories in that order with a package.json.
  const hits = [];
  let at = 0;
  while (hits.length < TARGET && at < order.length) {
    const batch = order.slice(at, at + WORKERS);
    at += batch.length;
    const answers = await Promise.all(batch.map(r => headOf(stratum, r.position, r.name, "package.json")));
    batch.forEach((r, i) => { if (answers[i].st === 200 && hits.length < TARGET) hits.push(r); });
    if (at % 400 === 0) console.log(JSON.stringify({ stratum, walked: at, hits: hits.length, ...stats }));
  }
  console.log(JSON.stringify({ stratum, screened: at, hits: hits.length, ...stats }));
  // The five files of each repository in the sample.
  const tasks = hits.flatMap(r => LOCKS.map(file => ({ r, file })));
  await pool(tasks, async ({ r, file }) => {
    const j = await headOf(stratum, r.position, r.name, file);
    if (file === "yarn.lock" && j.st === 200) await yarnKind(stratum, r.position, r.name);
  });
  console.log(JSON.stringify({ stratum, locksDone: hits.length, ...stats }));
}
console.log(JSON.stringify({ done: true, ...stats }));
