// Which of v4's 200 genuine updates involve a version the registry no longer lists (v4's registry cache, read-only)?
import { readFileSync, existsSync } from "node:fs";
const j = JSON.parse(readFileSync("/w/docs/bench/2026-10-28-backtest-v4/fixes-v4.json", "utf8"));
const out = [];
for (const r of j.rows) {
  const f = `/cache/registry/${encodeURIComponent(r.name)}.json`;
  const d = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
  const listed = v => d ? !!d.versions?.[v] : null;
  if (listed(r.to) !== true || listed(r.from) !== true) out.push({ update: `${r.name} ${r.from} -> ${r.to}`, from_listed: listed(r.from), to_listed: listed(r.to), verdict_with_exception: r.with_exception.verdict, stops: r.with_exception.stops });
}
console.log(JSON.stringify({ rows: j.rows.length, with_unlisted: out.length, list: out }, null, 1));
