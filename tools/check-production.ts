// Checks production right after a deploy (deploy.yml). Exits non-zero if any check fails.
//   1. build.json's built_at is newer than this job's start (waits up to 2 minutes for the new version).
//   2. The home page answers 200.
//   3. The ended 0.1.x endpoints (/index.json, /index/*, /mcp) answer 410 with the reason.
// Usage: STARTED_AT=<ISO time the job started> node tools/check-production.ts [site]
const site = process.argv[2] ?? "https://ludion.ai";
const startedAt = Date.parse(process.env.STARTED_AT ?? "");
const WAIT_MS = 120_000;

if (Number.isNaN(startedAt)) {
  console.error("STARTED_AT is missing or not a date. Set it to the time this job started, for example 2026-10-08T03:00:00Z.");
  process.exit(2);
}

async function newBuild(): Promise<string> {
  const deadline = Date.now() + WAIT_MS;
  let last = "none";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${site}/build.json?deploy-check=${Date.now()}`, { headers: { "cache-control": "no-cache" } });
      const builtAt = res.ok ? ((await res.json()) as { built_at?: string }).built_at ?? "none" : `HTTP ${res.status}`;
      last = builtAt;
      if (Date.parse(builtAt) > startedAt) return builtAt;
    } catch {
      // Not answering yet; try again.
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`build.json still shows built_at ${last}, not newer than this job's start (${process.env.STARTED_AT}). The new version isn't live.`);
}

const failures: string[] = [];
try {
  console.log(`build.json built_at ${await newBuild()} (job started ${process.env.STARTED_AT})`);
} catch (err) {
  failures.push((err as Error).message);
}

const home = await fetch(`${site}/`).catch((err: Error) => err);
if (home instanceof Response && home.ok) console.log("/: 200");
else failures.push(`/ answered ${home instanceof Response ? home.status : home.message}`);

for (const [path, method] of [["/index.json", "GET"], ["/index/subjects.json", "GET"], ["/mcp", "POST"]] as const) {
  const res = await fetch(`${site}${path}`, { method, ...(method === "POST" ? { body: "{}", headers: { "content-type": "application/json" } } : {}) }).catch((err: Error) => err);
  const body = res instanceof Response ? await res.text() : res.message;
  if (res instanceof Response && res.status === 410 && body.includes('"ended"')) console.log(`${path}: 410 ended`);
  else failures.push(`${path} answered ${res instanceof Response ? res.status : "no response"}: ${body.slice(0, 200)}`);
}

if (failures.length > 0) {
  console.error(`\nProduction check failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nProduction check passed.");
