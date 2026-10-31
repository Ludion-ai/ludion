// LDGLAT: count what docs/decisions/2026-11-01-ldglat-definitions.md section 5 names, from
// raw/commits.tsv, raw/packages.tsv and raw/fixes.tsv. Runs in a container (dpkg compares
// versions). Usage: node analyze.mjs <raw dir> <out dir>
// Writes <out>/units.tsv, <out>/tag-units.tsv, <out>/secondary-units.tsv, <out>/intervals.tsv,
// <out>/results.json and <out>/results.md, and prints results.md.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [raw, out] = process.argv.slice(2);
const WIN = Date.parse("2025-11-01T00:00:00Z");
const END = Date.parse("2026-10-31T14:59:06Z"); // repo-info 2427e432 commit time
const H = 3600e3;
const BASES = {
  "repos/debian/local/bookworm-slim.md": [
    "repos/node/local/22-bookworm-slim.md", "repos/node/local/24-bookworm-slim.md",
    "repos/php/local/8.2-cli-bookworm.md", "repos/php/local/8.3-cli-bookworm.md",
    "repos/php/local/8.4-cli-bookworm.md", "repos/php/local/8.4-fpm-bookworm.md",
    "repos/php/local/8.4-apache-bookworm.md", "repos/php/local/8.5-cli-bookworm.md",
  ],
  "repos/debian/local/bookworm.md": ["repos/node/local/22-bookworm.md", "repos/node/local/24-bookworm.md"],
};
const INTERVAL_FILES = [...Object.keys(BASES), "repos/buildpack-deps/local/bookworm.md", ...Object.values(BASES).flat()];
const short = (f) => f.replace(/^repos\/([^/]+)\/local\/(.+)\.md$/, "$1:$2");

const tsv = (f) => readFileSync(`${raw}/${f}`, "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
const files = new Map();
for (const [file, sha, t, id, created] of tsv("commits.tsv")) {
  if (!files.has(file)) files.set(file, []);
  files.get(file).push({ sha, t: Date.parse(t), id, created, pkgs: new Map() });
}
const bySha = new Map();
for (const [file, cs] of files) { cs.sort((a, b) => a.t - b.t); for (const c of cs) bySha.set(file + " " + c.sha, c); }
for (const [file, sha, , src, ver, bin] of tsv("packages.tsv")) bySha.get(file + " " + sha).pkgs.set(src, { ver, bin });

const memo = new Map();
function ge(a, b) { // dpkg: a >= b
  const k = a + "\u0000" + b;
  if (!memo.has(k)) {
    let r;
    try { execFileSync("dpkg", ["--compare-versions", a, "ge", b]); r = true; } catch (e) { if (e.status === 1) r = false; else throw e; }
    memo.set(k, r);
  }
  return memo.get(k);
}
const atOrBefore = (cs, t) => { let s = null; for (const c of cs) { if (c.t <= t) s = c; else break; } return s; };
// From the listing in effect at t0, the first commit (time >= t0) with src >= v.
function reach(cs, t0, src, v) {
  const start = atOrBefore(cs, t0);
  if (!start) return { kind: "no-file-at-start" };
  const p = start.pkgs.get(src);
  if (!p) return { kind: "not-listed-at-start" };
  if (ge(p.ver, v)) return { kind: "already-at-start", from: p.ver, startBin: p.bin };
  for (const c of cs) {
    if (c.t < t0) continue;
    const q = c.pkgs.get(src);
    if (!q) return { kind: "dropped", from: p.ver, startBin: p.bin, at: c };
    if (ge(q.ver, v)) return { kind: "reached", from: p.ver, to: q.ver, startBin: p.bin, at: c };
  }
  return { kind: "not-reached", from: p.ver, startBin: p.bin };
}

const hours = (ms) => Math.round(ms / H * 10) / 10;
const iso = (t) => new Date(t).toISOString().replace(".000Z", "Z");
function q(vals, p) { const s = [...vals].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(p * s.length) - 1)]; }
function summary(vals, notReached = []) {
  const n = vals.length;
  const r = { reached: n, not_reached: notReached.length };
  if (n) Object.assign(r, { min: q(vals, 0), p10: q(vals, 0.1), median: q(vals, 0.5), p90: q(vals, 0.9), max: q(vals, 1) });
  if (notReached.length) {
    r.not_reached_lower_bounds_h = notReached.sort((a, b) => a - b);
    const all = [...vals, ...notReached.map(() => Infinity)];
    const m = q(all, 0.5);
    r.median_with_not_reached_largest = m === Infinity ? "not reached" : m;
  }
  return r;
}
const count = (arr) => arr.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});

// Fixes.
const fixRows = tsv("fixes.tsv").map(([source, version, binary, start, kind, deb, why]) => ({ source, version, binary, start, kind, deb, why }));
const candidates = fixRows.length;
// Section 3 counts uploads "for bookworm". A version that ends in another release's suffix
// (20250419~deb12u1~deb11u1 is bullseye's copy of bookworm's 20250419~deb12u1) is not one.
// This reading was applied after the first run of this script showed such versions.
const otherRelease = (v) => { const m = /~deb(\d+)u\d+$/.exec(v); return m && m[1] !== "12"; };
for (const f of fixRows) if (!f.why && otherRelease(f.version)) f.why = "other-release-upload";
const leftOut = count(fixRows.filter((f) => f.why).map((f) => f.why));
const security = fixRows.filter((f) => !f.why);
const fixes = security.filter((f) => { const t = Date.parse(f.start); return t >= WIN && t < END; });
leftOut["start-before-window"] = security.filter((f) => Date.parse(f.start) < WIN).length;
leftOut["start-at-or-after-data-end"] = security.filter((f) => Date.parse(f.start) >= END).length;

const units = [], tagUnits = [], secondary = [];
const unitHead = ["base", "source", "version", "start", "start_kind", "base_from", "base_to", "t1", "t1_commit", "t1_created", "stage1_h", "result", "binary_mismatch"];
const baseOutcome = {}, alreadyAtStart = [];
for (const f of fixes) {
  const t0 = Date.parse(f.start);
  for (const [base, tags] of Object.entries(BASES)) {
    const r = reach(files.get(base), t0, f.source, f.version);
    baseOutcome[short(base)] ??= {};
    baseOutcome[short(base)][r.kind] = (baseOutcome[short(base)][r.kind] || 0) + 1;
    if (r.kind === "already-at-start") alreadyAtStart.push({ base: short(base), source: f.source, version: f.version, start: f.start, had: r.from });
    const isUnit = r.kind === "reached" || r.kind === "not-reached" || r.kind === "dropped";
    if (isUnit) {
      const u = { base: short(base), source: f.source, version: f.version, start: f.start, start_kind: f.kind,
        base_from: r.from, base_to: r.to || "", t1: r.kind === "reached" ? iso(r.at.t) : "", t1_commit: r.kind === "reached" ? r.at.sha : "",
        t1_created: r.kind === "reached" ? r.at.created : "", stage1_h: r.kind === "reached" ? hours(r.at.t - t0) : "",
        result: r.kind, binary_mismatch: r.startBin !== f.binary ? `${r.startBin}/${f.binary}` : "", lower_h: hours(END - t0), t1ms: r.kind === "reached" ? r.at.t : null, tags: [] };
      units.push(u);
      for (const tag of tags) {
        const s = reach(files.get(tag), t0, f.source, f.version);
        const tu = { base: u.base, tag: short(tag), source: f.source, version: f.version, start: f.start, result: s.kind,
          t2: s.kind === "reached" ? iso(s.at.t) : "", t2_commit: s.kind === "reached" ? s.at.sha : "",
          total_h: s.kind === "reached" ? hours(s.at.t - t0) : "",
          stage2_h: s.kind === "reached" && u.t1ms !== null ? hours(s.at.t - u.t1ms) : "", lower_h: hours(END - t0) };
        tagUnits.push(tu); u.tags.push(tu);
      }
    }
    // Secondary units: listed by a tag at the start, not by its base.
    const baseStart = atOrBefore(files.get(base), t0);
    for (const tag of tags) {
      if (baseStart && baseStart.pkgs.has(f.source)) continue;
      const s = reach(files.get(tag), t0, f.source, f.version);
      if (s.kind === "no-file-at-start" || s.kind === "not-listed-at-start" || s.kind === "already-at-start") continue;
      secondary.push({ tag: short(tag), source: f.source, version: f.version, start: f.start, result: s.kind,
        t2: s.kind === "reached" ? iso(s.at.t) : "", total_h: s.kind === "reached" ? hours(s.at.t - t0) : "", lower_h: hours(END - t0) });
    }
  }
}

// Summaries.
const res = { data_end: iso(END), window_start: iso(WIN), candidates, left_out: leftOut, fixes_in_window: fixes.length,
  fixes_start_kind: count(fixes.map((f) => f.kind)), base_outcome_per_fix: baseOutcome, already_at_start: alreadyAtStart, stage1: {}, events: {}, stage2: {}, total: {},
  per_unit_median_across_tags: {}, stage2_negative: {}, tag_outcome: {}, created_before_start: {}, binary_mismatch: units.filter((u) => u.binary_mismatch).length,
  secondary: {}, intervals: {}, commit_hours_utc: {} };
for (const base of Object.keys(BASES).map(short)) {
  const us = units.filter((u) => u.base === base);
  res.stage1[base] = { units: us.length, result: count(us.map((u) => u.result)),
    ...summary(us.filter((u) => u.result === "reached").map((u) => u.stage1_h), us.filter((u) => u.result === "not-reached").map((u) => u.lower_h)) };
  // Lower bound of stage 1 (section 4): the ending listing's Created minus the start.
  res.stage1[base + " lower bound (Created − start)"] = summary(us.filter((u) => u.result === "reached").map((u) => hours(Date.parse(u.t1_created) - Date.parse(u.start))));
  const ev = new Map();
  for (const u of us.filter((u) => u.result === "reached")) ev.set(u.t1_commit, (ev.get(u.t1_commit) || 0) + 1);
  res.events[base] = { distinct_t1_commits: ev.size, units_per_event: [...ev.entries()].map(([sha, n]) => {
    const u = us.find((x) => x.t1_commit === sha); return { t1: u.t1, created: u.t1_created, units: n };
  }).sort((a, b) => a.t1.localeCompare(b.t1)) };
  res.created_before_start[base] = us.filter((u) => u.result === "reached" && Date.parse(u.t1_created) < Date.parse(u.start)).length;
  const tus = tagUnits.filter((t) => t.base === base);
  const s2all = tus.filter((t) => t.stage2_h !== "").map((t) => t.stage2_h);
  res.stage2[base + " (all tags)"] = summary(s2all);
  res.total[base + " (all tags)"] = summary(tus.filter((t) => t.result === "reached").map((t) => t.total_h), tus.filter((t) => t.result === "not-reached").map((t) => t.lower_h));
  res.stage2_negative[base] = s2all.filter((x) => x < 0).length;
  const med = (vals) => vals.length ? q(vals, 0.5) : null;
  const pu2 = us.map((u) => med(u.tags.filter((t) => t.stage2_h !== "").map((t) => t.stage2_h))).filter((x) => x !== null);
  const puT = us.map((u) => med(u.tags.filter((t) => t.result === "reached").map((t) => t.total_h))).filter((x) => x !== null);
  res.per_unit_median_across_tags[base] = { stage2: summary(pu2), total: summary(puT),
    units_with_a_tag_not_reached: us.filter((u) => u.tags.some((t) => t.result === "not-reached")).length };
}
for (const tag of Object.values(BASES).flat().map(short)) {
  const tus = tagUnits.filter((t) => t.tag === tag);
  res.tag_outcome[tag] = count(tus.map((t) => t.result));
  res.stage2[tag] = summary(tus.filter((t) => t.stage2_h !== "").map((t) => t.stage2_h));
  res.total[tag] = summary(tus.filter((t) => t.result === "reached").map((t) => t.total_h), tus.filter((t) => t.result === "not-reached").map((t) => t.lower_h));
  const se = secondary.filter((s) => s.tag === tag);
  if (se.length) res.secondary[tag] = { units: se.length, result: count(se.map((s) => s.result)),
    ...summary(se.filter((s) => s.result === "reached").map((s) => s.total_h), se.filter((s) => s.result === "not-reached").map((s) => s.lower_h)) };
}

// Rebuild intervals (section 5): between consecutive commits in the window whose Image ID
// differs from the commit before, and separately whose dpkg listing differs.
const ivRows = [];
const listing = (c) => [...c.pkgs.entries()].map(([s, p]) => s + "=" + p.ver).sort().join(" ");
for (const file of INTERVAL_FILES) {
  const cs = files.get(file);
  const idCh = [], pkCh = [];
  let commitsInWindow = 0, noIdChange = 0;
  for (let i = 1; i < cs.length; i++) {
    if (cs[i].t < WIN || cs[i].t > END) continue;
    commitsInWindow++;
    if (cs[i].id !== cs[i - 1].id) idCh.push(cs[i].t); else noIdChange++;
    if (listing(cs[i]) !== listing(cs[i - 1])) pkCh.push(cs[i].t);
  }
  const iv = (ts) => ts.slice(1).map((t, i) => hours(t - ts[i]));
  const a = iv(idCh), b = iv(pkCh);
  const share = (xs, h) => xs.length ? `${xs.filter((x) => x < h).length}/${xs.length}` : "0/0";
  res.intervals[short(file)] = { commits_in_window: commitsInWindow, commits_without_image_id_change: noIdChange,
    image_id_changes: idCh.length, image_id: { ...summary(a), under_24h: share(a, 24), under_72h: share(a, 72) },
    dpkg_listing_changes: pkCh.length, dpkg_listing: { ...summary(b), under_24h: share(b, 24), under_72h: share(b, 72) } };
  for (const [kind, ts, xs] of [["image_id", idCh, a], ["dpkg_listing", pkCh, b]]) xs.forEach((x, i) => ivRows.push([short(file), kind, iso(ts[i]), iso(ts[i + 1]), x].join("\t")));
  res.commit_hours_utc[short(file)] = count(cs.filter((c) => c.t >= WIN).map((c) => String(new Date(c.t).getUTCHours()).padStart(2, "0")));
}

// Files.
const w = (name, head, rows) => writeFileSync(`${out}/${name}`, [head.join("\t"), ...rows.map((r) => head.map((k) => r[k] ?? "").join("\t"))].join("\n") + "\n");
w("units.tsv", [...unitHead, "lower_h"], units);
w("tag-units.tsv", ["base", "tag", "source", "version", "start", "result", "t2", "t2_commit", "stage2_h", "total_h", "lower_h"], tagUnits);
w("secondary-units.tsv", ["tag", "source", "version", "start", "result", "t2", "total_h", "lower_h"], secondary);
writeFileSync(`${out}/intervals.tsv`, ["file\tkind\tfrom\tto\thours", ...ivRows].join("\n") + "\n");
writeFileSync(`${out}/results.json`, JSON.stringify(res, null, 2) + "\n");

// results.md
const L = [];
const fmt = (s) => s.reached ? `${s.reached} | ${s.not_reached} | ${s.min} | ${s.p10} | ${s.median} | ${s.p90} | ${s.max}${s.median_with_not_reached_largest !== undefined ? ` | ${s.median_with_not_reached_largest}` : " | –"}` : `0 | ${s.not_reached} | – | – | – | – | – | –`;
const head = "| | reached | not reached | min | p10 | median | p90 | max | median, not reached as largest |\n|---|---|---|---|---|---|---|---|---|";
L.push(`# LDGLAT results (printed by scripts/analyze.mjs)`, "", `Window start ${res.window_start}, data end ${res.data_end}. Hours. Percentiles nearest-rank.`, "");
L.push(`Candidates ${candidates}; left out: ${JSON.stringify(leftOut)}; fixes in window: ${fixes.length} (${JSON.stringify(res.fixes_start_kind)}).`, "");
L.push("Per fix and base image, what the base listed at the start:", "");
for (const [b, o] of Object.entries(baseOutcome)) L.push(`- ${b}: ${JSON.stringify(o)}`);
L.push("", "## Stage 1: fix → base image (per unit)", "", head);
for (const [b, s] of Object.entries(res.stage1)) L.push(`| ${b}${s.units !== undefined ? ` (units ${s.units}, ${JSON.stringify(s.result)})` : ""} | ${fmt(s)} |`);
L.push("", "Fixes the base already had at the start: " + res.already_at_start.map((a) => `${a.base} ${a.source} ${a.version} (start ${a.start}, base had ${a.had})`).join("; "));
L.push("", "Independent events (distinct base-image commits that ended units):", "");
for (const [b, e] of Object.entries(res.events)) L.push(`- ${b}: ${e.distinct_t1_commits} commits; ` + e.units_per_event.map((x) => `${x.t1} (created ${x.created}): ${x.units}`).join("; "));
L.push("", `Units whose ending listing's Created is before the start: ${JSON.stringify(res.created_before_start)}. Binary at the start different from the one queried: ${res.binary_mismatch}.`);
L.push("", "## Stage 2: base image → official tag (per tag × unit)", "", head);
for (const [k, s] of Object.entries(res.stage2)) L.push(`| ${k} | ${fmt(s)} |`);
L.push("", `Negative stage 2 values (tag's commit before the base's): ${JSON.stringify(res.stage2_negative)}.`);
L.push("", "## Total: fix → official tag (per tag × unit)", "", head);
for (const [k, s] of Object.entries(res.total)) L.push(`| ${k} | ${fmt(s)} |`);
L.push("", "Tag outcomes: " + Object.entries(res.tag_outcome).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join("; "));
L.push("", "## Per unit, the median across its tags, then over units", "", head);
for (const [b, s] of Object.entries(res.per_unit_median_across_tags)) { L.push(`| ${b} stage 2 | ${fmt(s.stage2)} |`); L.push(`| ${b} total (units with a tag not reached: ${s.units_with_a_tag_not_reached}) | ${fmt(s.total)} |`); }
L.push("", "## Secondary units: package in the tag, not in its base (fix → tag)", "", head);
for (const [k, s] of Object.entries(res.secondary)) L.push(`| ${k} (units ${s.units}, ${JSON.stringify(s.result)}) | ${fmt(s)} |`);
L.push("", "## Rebuild intervals (hours between consecutive changes in the window)", "", "| file | commits | no Image ID change | Image ID changes | min | p10 | median | p90 | max | <24h | <72h | listing changes | median | <24h | <72h |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const [k, v] of Object.entries(res.intervals)) { const a = v.image_id, b = v.dpkg_listing; L.push(`| ${k} | ${v.commits_in_window} | ${v.commits_without_image_id_change} | ${v.image_id_changes} | ${a.min ?? "–"} | ${a.p10 ?? "–"} | ${a.median ?? "–"} | ${a.p90 ?? "–"} | ${a.max ?? "–"} | ${a.under_24h} | ${a.under_72h} | ${v.dpkg_listing_changes} | ${b.median ?? "–"} | ${b.under_24h} | ${b.under_72h} |`); }
L.push("", "## Commit hours (UTC) of each file in the window", "");
for (const [k, v] of Object.entries(res.commit_hours_utc)) L.push(`- ${k}: ${Object.entries(v).sort().map(([h, n]) => `${h}h ${n}`).join(", ")}`);
writeFileSync(`${out}/results.md`, L.join("\n") + "\n");
console.log(L.join("\n"));
