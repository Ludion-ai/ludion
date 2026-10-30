// LR step 3: the lag of each chosen repository and the summary
// (decision 2026-10-30-lr-dockerfile-lag-definitions, sections 3 to 5).
// Runs in Docker with no network: reads raw/, writes results.json and prints results.md.
import { readFileSync, writeFileSync } from "node:fs";

const dir = process.argv[2];
const raw = `${dir}/raw`;
const rel = `${raw}/releases`;
const read = (p) => readFileSync(p, "utf8");
const json = (p) => JSON.parse(read(p));

const mdate = read(`${raw}/search-started.txt`).slice(0, 10);
const DAY = 86400000;
const day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const mday = day(mdate);

const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const parseV = (s) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(s);
  return m ? [+m[1], +m[2], +m[3]] : null;
};

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const phpDate = (s) => {
  const m = /^(\d{1,2}) ([A-Z][a-z]{2})[a-z]* (\d{4})$/.exec(String(s ?? "").trim());
  return m && m[2] in MONTHS ? Date.UTC(+m[3], MONTHS[m[2]], +m[1]) : null;
};

// releases: { image: { series: [{ v, date, security, tagged }] } }
const releases = { php: {}, node: {} };
for (const major of [5, 7, 8]) {
  for (const [ver, r] of Object.entries(json(`${rel}/php-${major}.json`))) {
    const v = parseV(ver);
    if (!v) continue;
    const series = `${v[0]}.${v[1]}`;
    (releases.php[series] ??= []).push({
      v, ver, date: phpDate(r.date), tagged: Array.isArray(r.tags), security: Array.isArray(r.tags) && r.tags.includes("security"),
    });
  }
}
for (const r of json(`${rel}/node-index.json`)) {
  const v = parseV(r.version);
  if (!v) continue;
  (releases.node[String(v[0])] ??= []).push({ v, ver: r.version.slice(1), date: day(r.date), tagged: true, security: r.security === true });
}
const phpStates = json(`${rel}/php-states.json`);
const nodeSchedule = json(`${rel}/node-schedule.json`);
const eolOf = (image, series) => {
  if (image === "php") {
    const s = phpStates[series.split(".")[0]]?.[series]?.state;
    return s === undefined ? "unknown" : s === "eol";
  }
  const end = nodeSchedule[`v${series}`]?.end;
  return end === undefined ? "unknown" : day(end) < mday;
};

const REF = /^\s*from\s+(?:--platform=\S+\s+)?(?:docker\.io\/library\/|index\.docker\.io\/library\/|docker\.io\/|library\/)?(php|node):(\d+)\.(\d+)\.(\d+)(-[A-Za-z0-9._-]+)?(@sha256:[0-9a-f]{64})?(?:\s+as\s+\S+)?\s*$/i;

const lines = read(`${raw}/checked.tsv`).split("\n").filter(Boolean);
const head = lines.shift().split("\t");
const rows = lines.map((l) => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v])));
const chosen = rows.filter((r) => r.outcome === "selected");

const out = chosen.map((r) => {
  const m = REF.exec(r.from_line);
  const base = { stratum: r.stratum, repo: r.full_name, path: r.path, from: r.from_line, dependabot_docker: r.dependabot_docker, renovate: r.renovate };
  if (!m || m[1] !== r.stratum) return { ...base, countable: false, reason: "measured line does not parse" };
  const v = [+m[2], +m[3], +m[4]];
  const image = m[1];
  const series = image === "php" ? `${v[0]}.${v[1]}` : String(v[0]);
  const list = releases[image][series] ?? [];
  const pinned = list.find((x) => cmp(x.v, v) === 0);
  const digest = Boolean(m[6]);
  const eol = eolOf(image, series);
  if (!pinned) return { ...base, image, version: v.join("."), series, digest, eol, countable: false, reason: "pinned version not in the official list" };
  const newer = list.filter((x) => cmp(x.v, v) > 0);
  const sec = newer.filter((x) => x.security).sort((a, b) => cmp(a.v, b.v));
  const latest = sec.at(-1);
  const earliest = sec[0];
  if ((latest && latest.date === null) || (earliest && earliest.date === null)) {
    return { ...base, image, version: v.join("."), series, digest, eol, countable: false, reason: "release date does not parse" };
  }
  return {
    ...base, image, version: v.join("."), series, digest, eol, countable: true,
    latest_security: latest?.ver ?? null,
    latest_security_date: latest ? new Date(latest.date).toISOString().slice(0, 10) : null,
    lag_days: latest ? Math.round((mday - latest.date) / DAY) : 0,
    earliest_security: earliest?.ver ?? null,
    exposure_days: earliest ? Math.round((mday - earliest.date) / DAY) : 0,
    newer_security_releases: sec.length,
    newer_untagged_releases: newer.filter((x) => !x.tagged).length,
  };
});

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const p90 = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.ceil(0.9 * s.length) - 1];
};
const stats = (rs) => {
  const c = rs.filter((r) => r.countable);
  const lag = c.map((r) => r.lag_days);
  const exp = c.map((r) => r.exposure_days);
  return {
    repos: rs.length, countable: c.length, not_countable: rs.length - c.length,
    lag_median: median(lag), lag_p90: p90(lag),
    exposure_median: median(exp), exposure_p90: p90(exp),
    behind: c.filter((r) => r.lag_days > 0).length,
    eol_series: rs.filter((r) => r.eol === true).length,
    eol_unknown: rs.filter((r) => r.eol === "unknown").length,
  };
};
const configured = (r) => r.dependabot_docker === "yes" || r.renovate === "yes";
const notConfigured = (r) => r.dependabot_docker === "no" && r.renovate === "no";
const groups = {
  all: out,
  php: out.filter((r) => r.stratum === "php"),
  node: out.filter((r) => r.stratum === "node"),
  configured: out.filter(configured),
  not_configured: out.filter(notConfigured),
  configuration_unknown: out.filter((r) => !configured(r) && !notConfigured(r)),
  dependabot_docker: out.filter((r) => r.dependabot_docker === "yes"),
  renovate: out.filter((r) => r.renovate === "yes"),
  both: out.filter((r) => r.dependabot_docker === "yes" && r.renovate === "yes"),
};
const summary = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, stats(v)]));
const digest = {
  all: out.filter((r) => r.digest === true).length,
  php: out.filter((r) => r.stratum === "php" && r.digest === true).length,
  node: out.filter((r) => r.stratum === "node" && r.digest === true).length,
};
const outcomes = {};
for (const r of rows) {
  const k = `${r.stratum}\t${r.outcome.replace(/\(.*\)$/, "")}`;
  outcomes[k] = (outcomes[k] ?? 0) + 1;
}
const untaggedRepos = out.filter((r) => r.newer_untagged_releases > 0).length;

writeFileSync(`${dir}/results.json`, JSON.stringify({ measurement_date: mdate, summary, digest, outcomes, untagged_repos: untaggedRepos, repos: out }, null, 2) + "\n");

const fmt = (x) => (x === null ? "-" : String(x));
const md = [];
md.push(`measurement date (UTC): ${mdate}`, "");
md.push("| group | repos | countable | not countable | lag median | lag p90 | exposure median | exposure p90 | behind (lag > 0) | EOL series |");
md.push("|---|---|---|---|---|---|---|---|---|---|");
for (const [k, s] of Object.entries(summary)) {
  md.push(`| ${k} | ${s.repos} | ${s.countable} | ${s.not_countable} | ${fmt(s.lag_median)} | ${fmt(s.lag_p90)} | ${fmt(s.exposure_median)} | ${fmt(s.exposure_p90)} | ${s.behind} | ${s.eol_series}${s.eol_unknown ? ` (+${s.eol_unknown} unknown)` : ""} |`);
}
md.push("", `digest pinned: ${digest.all} of ${out.length} (php ${digest.php}, node ${digest.node})`);
md.push(`repositories with an untagged PHP release newer than the pinned one: ${untaggedRepos}`, "");
md.push("| stratum | outcome | repositories |", "|---|---|---|");
for (const [k, n] of Object.entries(outcomes).sort()) md.push(`| ${k.replace("\t", " | ")} | ${n} |`);
md.push("");
for (const r of out.filter((x) => !x.countable)) md.push(`not countable: ${r.repo} ${r.from} — ${r.reason}`);
process.stdout.write(md.join("\n") + "\n");
