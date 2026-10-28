// L1c: docs/bench/2026-10-28-noise/scripts/join.mjs, unchanged. Joins each hour's two saved pages of 50 into hour-HH.json, the shape noise.ts reads ({ data: { search: { issueCount,
// nodes } } }), page 1's nodes then page 2's. Nothing is fetched.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
for (let h = 0; h < 24; h++) {
  const hh = String(h).padStart(2, "0");
  const p1 = JSON.parse(readFileSync(`/out/search/hour-${hh}.p1.json`, "utf8"));
  const p2file = `/out/search/hour-${hh}.p2.json`;
  const p2 = existsSync(p2file) ? JSON.parse(readFileSync(p2file, "utf8")) : null;
  const nodes = [...p1.data.search.nodes, ...(p2 ? p2.data.search.nodes : [])];
  writeFileSync(`/out/search/hour-${hh}.json`, JSON.stringify({ data: { search: { issueCount: p1.data.search.issueCount, nodes } } }));
  console.log(hh, p1.data.search.issueCount, nodes.length);
}
