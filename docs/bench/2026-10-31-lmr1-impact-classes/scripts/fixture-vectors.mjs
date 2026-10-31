// node fixture-vectors.mjs <fixture.json>...: for each real record kept as a test fixture, its id, CWEs and the raw
// score of each severity entry, one per line (tab-separated). LMR1c wrote the fixtures' expected classes from these
// fields, apart from classify().
import { readFileSync } from "node:fs";

for (const path of process.argv.slice(2)) {
  for (const r of JSON.parse(readFileSync(path, "utf8"))) {
    const cwes = Array.isArray(r.database_specific?.cwe_ids) ? r.database_specific.cwe_ids.join(",") : "-";
    const scores = Array.isArray(r.severity) ? r.severity.map(s => `${s.type} ${s.score}`).join(" ; ") : "-";
    console.log([path.split("/").pop(), r.id, cwes || "-", scores || "-"].join("\t"));
  }
}
