// node list-strong.mjs <stronger.tsv>: every record that moved to takeover or impersonate (the strong side), from
// stronger.tsv (count.sh --stronger), as a Markdown table per comparison, sorted by id (LMR1g). Reads only the file it
// is given; the ids, CWEs and vectors are data.
import { readFileSync } from "node:fs";

const [header, ...lines] = readFileSync(process.argv[2], "utf8").trimEnd().split("\n");
const cols = header.split("\t");
const rows = lines.map(line => Object.fromEntries(line.split("\t").map((v, i) => [cols[i], v])));
for (const comparison of [...new Set(rows.map(r => r.comparison))].sort()) {
  const strong = rows.filter(r => r.comparison === comparison && (r.after === "takeover" || r.after === "impersonate"));
  console.log(`### ${comparison}: ${strong.length} records to takeover or impersonate`);
  console.log("");
  console.log("| # | id | ecosystem | before → after | CWEs |");
  console.log("|---|---|---|---|---|");
  strong.forEach((r, i) => console.log(`| ${i + 1} | ${r.id} | ${r.ecosystem} | ${r.before} → ${r.after} | ${r.cwes.replaceAll(",", ", ")} |`));
  console.log("");
}
