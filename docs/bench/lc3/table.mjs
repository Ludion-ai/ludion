// The tables in docs/bench/lc3/README.md, from lc3-rows.json: node table.mjs <lc3-rows.json>. Reads that file only.
import { readFileSync } from "node:fs";

const { rows } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const stopped = rows.filter(r => r.stopped);
const cell = text => String(text ?? "").replace(/[\r\n|]+/g, " ").slice(0, 160);

function outcome(c) {
  if (!c) return "passes as it is";
  if (c.none) {
    const over = {};
    for (const p of c.passed_over ?? []) over[p.reason] = (over[p.reason] ?? 0) + 1;
    const list = Object.entries(over).map(([k, v]) => `${k} ${v}`).join(", ");
    return `no candidate: ${c.none}${list ? ` (${list})` : ""}`;
  }
  if (c.passes) return `**${c.version} passes**`;
  return `${c.version} fails: ${[c.publisher_check === "stop" ? "publisher check" : null, ...c.signals].filter(Boolean).join(", ")}`;
}

console.log("| Fix | Urgency, wait | Stop signals on main | Deprecation kind | Reading A | Reading B | Reading C | main's nextFix today |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const r of stopped) {
  const n = r.main_next_fix;
  const next = n?.smallest_usable ? "smallest usable" : n?.error ? "error" : n?.chosen ? `${n.chosen} (${n.within_cutoff ? "by the cutoff" : "after the cutoff"})` : n?.malicious ? "stops: MAL-" : n?.publisher_check === "stop" ? "stops: publisher check" : "none qualifies";
  console.log(`| ${r.name}@${r.to} | ${r.urgency}, ${r.wait_hours}h | ${r.signals.join(", ")} | ${r.deprecation?.kind ?? ""} | ${outcome(r.readings.A.candidate)} | ${outcome(r.readings.B.candidate)} | ${outcome(r.readings.C.candidate)} | ${next} |`);
}

console.log("\n### Deprecation messages and evidence\n");
console.log("| Fix | Kind | Message (data, first 160 characters) | Evidence |");
console.log("| --- | --- | --- | --- |");
for (const r of stopped.filter(x => x.deprecation)) console.log(`| ${r.name}@${r.to} | ${r.deprecation.kind} | ${cell(r.deprecation.message)} | ${cell(r.deprecation.evidence.join("; "))} |`);

console.log("\n### Other stop messages\n");
for (const r of stopped) for (const m of r.stops.filter(s => !/ is deprecated/.test(s))) console.log(`- ${r.name}@${r.to}: ${cell(m.length > 160 ? `${m.slice(0, 157)}...` : m)}`);

console.log("\n### Candidates that pass, reading A\n");
for (const r of stopped) { const c = r.readings.A.candidate; if (c?.passes) console.log(`- ${r.name}@${r.to} to ${c.version}, published ${c.published}, cutoff ${r.cutoff}, check ${c.publisher_check}, urgency ${c.urgency}, wait ${c.wait_hours}h, added delay ${c.added_delay_hours}h, OSV names ${c.osv_named.length}, inside next-fix limits ${c.in_next_fix_limits}`); }
