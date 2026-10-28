// Prints the README's tables from malicious-v5.json, so every number is copied from the raw output, not typed.
import { readFileSync } from "node:fs";
const j = JSON.parse(readFileSync(process.argv[2], "utf8"));
const U = ["exploited", "high", "normal", "low"];
const WAIT = { exploited: "12h", high: "24h", normal: "72h", low: "168h" };
const N = j.denominator;
const pct = (a, b) => `${(100 * a / b).toFixed(2)}%`;
const frac = s => { const [a, b] = s.split(" / ").map(Number); return `${a.toLocaleString("en")} / ${b.toLocaleString("en")} = ${pct(a, b)}`; };
console.log("## run", JSON.stringify(j.run), "\nv4 reproduced differences:", j.v4_reproduced.differences, JSON.stringify(j.v4_reproduced.first.slice(0, 5)));
console.log("gate:", JSON.stringify(j.gate_every_malicious_version_stopped));
console.log("\n## outcomes (primary): with conservative | with optimistic | without conservative");
for (const u of U) {
  const c = m => t => { const x = j.by_urgency[m][u][t].primary; return `${x.stopped} / ${x.missed} / ${x.unknown}`; };
  console.log(`| ${u} (${WAIT[u]}) | ${c("with_exception")("conservative")} | ${c("with_exception")("optimistic")} | ${c("without_exception")("conservative")} |`);
}
console.log("\n## per scenario (with, conservative): a | b");
for (const u of U) { const x = j.by_urgency.with_exception[u].conservative; console.log(`| ${u} | ${x.a.stopped} / ${x.a.missed} / ${x.a.unknown} | ${x.b.stopped} / ${x.b.missed} / ${x.b.unknown} |`); }
console.log("\n## interval (with, conservative) | optimistic | without conservative");
for (const u of U) { const i = j.stop_rate_interval; console.log(`| ${u} (${WAIT[u]}) | ${frac(i.with_exception[u].conservative.lower)} | ${frac(i.with_exception[u].conservative.upper)} | ${frac(i.with_exception[u].optimistic.lower)} – ${frac(i.with_exception[u].optimistic.upper)} | ${frac(i.without_exception[u].conservative.lower)} – ${frac(i.without_exception[u].conservative.upper)} |`); }
console.log("\n## stops by signal (with, conservative): fires / alone");
const keys = Object.keys(j.stops_by_signal.with_exception.low).filter(k => k !== "stopped");
console.log(`| signal | ${U.join(" | ")} |`);
console.log(`| stopped | ${U.map(u => j.stops_by_signal.with_exception[u].stopped).join(" | ")} |`);
for (const k of keys) console.log(`| ${k} | ${U.map(u => `${j.stops_by_signal.with_exception[u][k].fires} / ${j.stops_by_signal.with_exception[u][k].alone}`).join(" | ")} |`);
console.log("\n## v4 reproduced stops by signal (with, conservative)");
const k4 = Object.keys(j.v4_stops_by_signal_reproduced.with_exception.low).filter(k => k !== "stopped");
console.log(`| stopped | ${U.map(u => j.v4_stops_by_signal_reproduced.with_exception[u].stopped).join(" | ")} |`);
for (const k of k4) console.log(`| ${k} | ${U.map(u => `${j.v4_stops_by_signal_reproduced.with_exception[u][k].fires} / ${j.v4_stops_by_signal_reproduced.with_exception[u][k].alone}`).join(" | ")} |`);
console.log("\n## changes from v4 (with, conservative)");
for (const u of U) { const c = j.changes_from_v4_with_exception[u]; console.log(u, c.moved, JSON.stringify(c.from_to), JSON.stringify(c.by_stop_source)); }
console.log("\n## install scripts", JSON.stringify(j.install_scripts, null, 1));
console.log("\n## software heritage", JSON.stringify(j.software_heritage, null, 1));
console.log("\n## requests", JSON.stringify(j.requests));
console.log("\n## disputed funnel", JSON.stringify(j.disputed.funnel, null, 1), "\ncount", j.disputed.count);
for (const v of j.disputed.versions) console.log(JSON.stringify(v));
console.log("\n## disputed vs others (with, conservative, primary)");
for (const u of U) { const d = j.disputed.by_urgency.disputed[u].conservative.primary, o = j.disputed.by_urgency.others[u].conservative.primary; console.log(`| ${u} | ${d.stopped} / ${d.missed} / ${d.unknown} | ${o.stopped} / ${o.missed} / ${o.unknown} |`); }
console.log("\n## fixes", JSON.stringify(j.fixes));
// Script facts by source among the versions moved to stopped
const moved = new Set(U.flatMap(u => j.changes_from_v4_with_exception[u].versions.map(v => v.version)));
console.log("\n## moved versions", moved.size);
for (const u of U) console.log(u, JSON.stringify(j.changes_from_v4_with_exception[u].versions.map(v => `${v.version} ${v.from}->${v.to} ${v.other_stops.join(";")}`)));
// The miss(es) and their facts
const missed = j.rows.filter(r => U.some(u => r.with_exception.outcomes[u].conservative.primary === "missed"));
for (const r of missed) console.log("\n## missed", `${r.name}@${r.version}`, JSON.stringify(r.scripts), JSON.stringify(r.disputed.step), JSON.stringify(Object.fromEntries(U.map(u => [u, r.with_exception.outcomes[u].conservative.primary]))));
