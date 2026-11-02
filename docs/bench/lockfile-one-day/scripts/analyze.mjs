// Runs with no network. From the journal and the order files, writes the raw tables and the counts. See the definition, sections 3 to 6.
// usage: node analyze.mjs <folder of the order files> <journal file> <population-summary.json> <output folder> [per-stratum target]
//        node analyze.mjs --self-test
import { readFileSync, writeFileSync } from "node:fs";

const Z = 1.959964;

function wilson(k, n) {
  if (!(n > 0)) return [null, null];
  const p = k / n;
  const d = 1 + (Z * Z) / n;
  const c = p + (Z * Z) / (2 * n);
  const m = Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

if (process.argv[2] === "--self-test") {
  const near = (a, b) => Math.abs(a - b) < 5e-4;
  const [l, h] = wilson(50, 100); // 0.4038, 0.5962
  const [l0, h0] = wilson(0, 500); // 0, 0.0076
  if (!near(l, 0.4038) || !near(h, 0.5962) || !near(l0, 0) || !near(h0, 0.0076)) throw new Error(`wilson ${l} ${h} ${l0} ${h0}`);
  console.log("self-test ok");
  process.exit(0);
}

const [popDir, journalFile, popSummaryFile, outDir, targetText] = process.argv.slice(2);
const TARGET = Number(targetText ?? 500);
const FILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];
const pop = JSON.parse(readFileSync(popSummaryFile, "utf8"));

const journal = new Map();
let firstAt = null, lastAt = null, tries2 = 0;
for (const line of readFileSync(journalFile, "utf8").split("\n")) {
  if (!line) continue;
  const j = JSON.parse(line);
  journal.set(`${j.s}:${j.p}:${j.f}`, j);
  if (!firstAt || j.at < firstAt) firstAt = j.at;
  if (!lastAt || j.at > lastAt) lastAt = j.at;
  if (j.tries === 2) tries2++;
}
const get = (s, p, f) => journal.get(`${s}:${p}:${f}`);

const known = st => st === 200 || st === 404;
const present = st => st === 200;
const rows = { new: [], old: [] };
const screenCsv = ["stratum,position,repo_id,repo,package_json_status,in_sample"];
const sampleCsv = ["stratum,position,repo_id,repo,package_json_status,package_lock_status,pnpm_lock_status,yarn_lock_status,yarn_kind,bun_lock_status,bun_lockb_status"];
const screening = {};
const statuses = { "package.json": {}, locks: {}, yarnHead: {} };
const noteStatus = (where, st) => { statuses[where][st] = (statuses[where][st] ?? 0) + 1; };

for (const stratum of ["new", "old"]) {
  const order = readFileSync(`${popDir}/order-${stratum}.tsv`, "utf8").split("\n").filter(Boolean).map(l => l.split("\t"));
  const s = { walked: 0, present: 0, absent: 0, unknown: 0, sampled: 0 };
  for (const [position, id, name] of order) {
    const j = get(stratum, position, "package.json");
    if (!j) break; // the walk stopped here
    noteStatus("package.json", j.st);
    s.walked++;
    let inSample = "no";
    if (j.st === 200) s.present++; else if (j.st === 404) s.absent++; else s.unknown++;
    if (j.st === 200 && s.sampled < TARGET) {
      s.sampled++;
      inSample = "yes";
      const st = FILES.map(f => get(stratum, position, f)?.st ?? "not-asked");
      st.forEach(x => noteStatus("locks", x));
      const kindEntry = get(stratum, position, "yarn.kind");
      if (kindEntry) noteStatus("yarnHead", kindEntry.st);
      const yarnKind = st[2] === 200 ? (kindEntry?.kind ?? "unknown") : st[2] === 404 ? "" : "unknown";
      rows[stratum].push({ id, name, st, yarnKind });
      sampleCsv.push([stratum, position, id, name, j.st, st[0], st[1], st[2], yarnKind, st[3], st[4]].join(","));
    }
    screenCsv.push([stratum, position, id, name, j.st, inSample].join(","));
  }
  screening[stratum] = s;
}

/** Each measure says, for a row, true, false or null (not known). */
const anyOf = (r, idx) => (idx.some(i => present(r.st[i])) ? true : idx.every(i => known(r.st[i])) ? false : null);
const allKnown = r => r.st.every(known);
const nPresent = r => r.st.filter(present).length;
const only = i => r => (allKnown(r) ? nPresent(r) === 1 && present(r.st[i]) : null);
const yarnIs = kind => r => (known(r.st[2]) ? (present(r.st[2]) ? (r.yarnKind === "unknown" ? null : r.yarnKind === kind) : false) : null);
const measures = [
  ["package-lock.json", "any", r => anyOf(r, [0])],
  ["pnpm-lock.yaml", "any", r => anyOf(r, [1])],
  ["yarn.lock (either format)", "any", r => anyOf(r, [2])],
  ["yarn.lock, v1", "any", yarnIs("v1")],
  ["yarn.lock, berry", "any", yarnIs("berry")],
  ["yarn.lock, neither format's line", "any", yarnIs("other")],
  ["bun.lock or bun.lockb", "any", r => anyOf(r, [3, 4])],
  ["bun.lock", "any", r => anyOf(r, [3])],
  ["bun.lockb", "any", r => anyOf(r, [4])],
  ["only package-lock.json", "alone", only(0)],
  ["only pnpm-lock.yaml", "alone", only(1)],
  ["only yarn.lock", "alone", only(2)],
  ["only bun.lock", "alone", only(3)],
  ["only bun.lockb", "alone", only(4)],
  ["two or more of the five", "alone", r => (allKnown(r) ? nPresent(r) >= 2 : null)],
  ["none of the five", "alone", r => (allKnown(r) ? nPresent(r) === 0 : null)],
];

const rate = s => s.present / (s.present + s.absent);
const weightRaw = { new: pop.strata.new * rate(screening.new), old: pop.strata.old * rate(screening.old) };
const weightSum = weightRaw.new + weightRaw.old;
const W = { new: weightRaw.new / weightSum, old: weightRaw.old / weightSum };

const pct = x => (x === null ? "不明" : `${(x * 100).toFixed(1)}%`);
const table = [];
const summaryRows = [];
for (const [label, group, f] of measures) {
  const per = {};
  for (const stratum of ["new", "old"]) {
    let k = 0, n = 0, unknown = 0;
    for (const r of rows[stratum]) {
      const v = f(r);
      if (v === null) unknown++;
      else { n++; if (v) k++; }
    }
    const [lo, hi] = wilson(k, n);
    per[stratum] = { k, n, unknown, share: n ? k / n : null, lo, hi };
  }
  const share = W.new * per.new.share + W.old * per.old.share;
  const nEff = 1 / ((W.new * W.new) / per.new.n + (W.old * W.old) / per.old.n);
  const [lo, hi] = wilson(share * nEff, nEff);
  summaryRows.push({ label, group, new: per.new, old: per.old, overall: { share, nEff, lo, hi } });
  table.push(`| ${label} | ${per.new.k}/${per.new.n} = ${pct(per.new.share)} (${pct(per.new.lo)}–${pct(per.new.hi)}) | ${per.old.k}/${per.old.n} = ${pct(per.old.share)} (${pct(per.old.lo)}–${pct(per.old.hi)}) | ${pct(share)} (${pct(lo)}–${pct(hi)}) | ${per.new.unknown + per.old.unknown} |`);
}

const md = [
  `Printed by scripts/analyze.mjs. Pushes of ${pop.day} (UTC); files as raw.githubusercontent.com answered from ${firstAt} to ${lastAt}.`,
  "",
  `Population: new ${pop.strata.new}, old ${pop.strata.old}. Screening (package.json): new ${JSON.stringify(screening.new)}, old ${JSON.stringify(screening.old)}. Weights: new ${W.new.toFixed(4)}, old ${W.old.toFixed(4)}. Effective n of the overall column: ${summaryRows[0].overall.nEff.toFixed(0)}.`,
  "",
  "| Measure | New (id at or above the boundary): k/n = share (95% Wilson) | Old: k/n = share (95% Wilson) | Overall, weighted (95% Wilson on the effective n) | Unknown (repositories) |",
  "|---|---|---|---|---|",
  ...table,
  "",
].join("\n");

writeFileSync(`${outDir}/screen.csv`, screenCsv.join("\n") + "\n");
writeFileSync(`${outDir}/sample.csv`, sampleCsv.join("\n") + "\n");
writeFileSync(`${outDir}/counts.md`, md);
writeFileSync(`${outDir}/counts.json`, JSON.stringify({ day: pop.day, measuredFrom: firstAt, measuredTo: lastAt, strata: pop.strata, screening, weights: W, statuses, answersThatTookASecondTry: tries2, requestsAnswered: journal.size, rows: summaryRows }, null, 1) + "\n");
console.log(md);
