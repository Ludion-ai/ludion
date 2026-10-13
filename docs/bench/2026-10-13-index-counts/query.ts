// Runs daily.sql and shards.sql against Analytics Engine and prints them, plus the week's client-days.
//   CLOUDFLARE_ACCOUNT_ID=<id> CLOUDFLARE_API_TOKEN=<token with Account Analytics: Read> node docs/bench/2026-10-13-index-counts/query.ts
// The token stays in the environment; nothing here writes it anywhere.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const base = process.env.CLOUDFLARE_API_BASE ?? "https://api.cloudflare.com"; // only a test points it elsewhere
if (!account || !token) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Account Analytics: Read).");
  process.exit(2);
}

async function run(file: string): Promise<Record<string, string | number>[]> {
  const sql = readFileSync(join(import.meta.dirname, file), "utf8");
  const res = await fetch(`${base}/client/v4/accounts/${account}/analytics_engine/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: sql,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}: ${text.slice(0, 300)}`);
  return (JSON.parse(text) as { data: Record<string, string | number>[] }).data;
}

// The SQL looks back eight days from now, so its oldest day is partial and today is still running: only the seven
// whole UTC days before today are summed.
const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
const whole = new Set(Array.from({ length: 7 }, (_, i) => day(i + 1)));

const daily = await run("daily.sql");
console.log("Distinct clients per day and CLI label (a client is one IP + User-Agent on one day; the oldest and today's rows are partial):");
console.table(daily);
// Keys are rotated daily, so a week's number is client-days (the sum of the days), not people.
const clientDays = daily.filter((r) => whole.has(String(r.day))).reduce((n, r) => n + Number(r.clients), 0);
console.log(`Client-days over the 7 whole days ${day(7)} to ${day(1)}: ${clientDays}. This is not a count of people: the same machine on three days is three client-days.`);
console.log("\nRequests per file per day:");
console.table(await run("shards.sql"));
