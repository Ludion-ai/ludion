// Runs inside workerd. The counting code is exercised directly and through createApp with a stub ASSETS, so the
// secret, the dataset and the client address can be set per test.
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp, type Env } from "../src/app.ts";
import { clientKey, clientLabel, countIndexRequest, MIN_SALT_LENGTH, SHARD_PATH, type CountEnv } from "../src/index-counts.ts";

const SALT = "s".repeat(MIN_SALT_LENGTH);
const NOW = new Date("2026-10-13T23:59:59Z");

interface Point {
  indexes?: string[];
  blobs?: string[];
  doubles?: number[];
}

function dataset(): { binding: AnalyticsEngineDataset; points: Point[] } {
  const points: Point[] = [];
  return { binding: { writeDataPoint: (p?: Point) => void points.push(p ?? {}) } as AnalyticsEngineDataset, points };
}

function shardRequest(path = "/index/vitest.json", headers: Record<string, string> = { "CF-Connecting-IP": "203.0.113.7", "User-Agent": "ludion-ai/0.1.4" }, method = "GET") {
  return new Request(`https://ludion.ai${path}`, { method, headers });
}

describe("clientLabel", () => {
  it("keeps the CLI's version and calls everything else other", () => {
    expect(clientLabel("ludion-ai/0.1.4")).toBe("ludion-ai/0.1.4");
    for (const ua of [null, "", "node", "Mozilla/5.0", "ludion-ai/0.1.4 extra", "ludion-ai/1.2", "ludion-ai/0.1.4\n", "x".repeat(5000)]) {
      expect(clientLabel(ua), String(ua).slice(0, 20)).toBe("other");
    }
  });
});

describe("clientKey", () => {
  it("is 32 hex characters, stable, and different for a different day, address, User-Agent or secret", async () => {
    const base = await clientKey(SALT, "2026-10-13", "203.0.113.7", "ludion-ai/0.1.4");
    expect(base).toMatch(/^[0-9a-f]{32}$/);
    expect(await clientKey(SALT, "2026-10-13", "203.0.113.7", "ludion-ai/0.1.4")).toBe(base);
    expect(await clientKey(SALT, "2026-10-14", "203.0.113.7", "ludion-ai/0.1.4")).not.toBe(base);
    expect(await clientKey(SALT, "2026-10-13", "203.0.113.8", "ludion-ai/0.1.4")).not.toBe(base);
    expect(await clientKey(SALT, "2026-10-13", "203.0.113.7", "ludion-ai/0.1.5")).not.toBe(base);
    expect(await clientKey("t".repeat(MIN_SALT_LENGTH), "2026-10-13", "203.0.113.7", "ludion-ai/0.1.4")).not.toBe(base);
  });
});

describe("SHARD_PATH", () => {
  it("matches the files `ludion sync` downloads and nothing else", () => {
    for (const p of ["/index/subjects.json", "/index/vitest.json", "/index/cloudflare-workers.json", "/index/a.b_c.json"]) expect(SHARD_PATH.test(p), p).toBe(true);
    for (const p of ["/index.json", "/index/", "/index/x.txt", "/index/a/b.json", "/index/%2e%2e.json", "/lessons/x.json", "/index/vitest.json/"]) expect(SHARD_PATH.test(p), p).toBe(false);
  });
});

describe("countIndexRequest", () => {
  it("writes one point: the day, the path, the CLI version, and the key as the index, and not the address or the User-Agent", async () => {
    const d = dataset();
    await countIndexRequest(shardRequest(), { INDEX_HITS: d.binding, ANALYTICS_SALT: SALT }, NOW);
    expect(d.points).toHaveLength(1);
    const p = d.points[0]!;
    expect(p.indexes).toEqual([await clientKey(SALT, "2026-10-13", "203.0.113.7", "ludion-ai/0.1.4")]);
    expect(p.blobs).toEqual(["2026-10-13", "/index/vitest.json", "ludion-ai/0.1.4"]);
    const written = JSON.stringify(p);
    expect(written).not.toContain("203.0.113.7");
    expect(written).not.toContain(SALT);
  });

  it("keeps the other User-Agents out of the data: an unknown one is written as other", async () => {
    const d = dataset();
    const ua = "Mozilla/5.0 (secret-looking-agent-string)";
    await countIndexRequest(shardRequest("/index/subjects.json", { "CF-Connecting-IP": "203.0.113.7", "User-Agent": ua }), { INDEX_HITS: d.binding, ANALYTICS_SALT: SALT }, NOW);
    expect(d.points[0]!.blobs![2]).toBe("other");
    expect(JSON.stringify(d.points[0])).not.toContain("secret-looking");
  });

  it("uses the UTC day, so a request just before midnight and one just after are different clients", async () => {
    const d = dataset();
    const env = { INDEX_HITS: d.binding, ANALYTICS_SALT: SALT };
    await countIndexRequest(shardRequest(), env, new Date("2026-10-13T23:59:59Z"));
    await countIndexRequest(shardRequest(), env, new Date("2026-10-14T00:00:01Z"));
    expect(d.points.map((p) => p.blobs![0])).toEqual(["2026-10-13", "2026-10-14"]);
    expect(d.points[0]!.indexes![0]).not.toBe(d.points[1]!.indexes![0]);
  });

  it("counts nothing without the secret, with a short one, without the dataset, without an address, for a POST, or for another path", async () => {
    const d = dataset();
    const ok: CountEnv = { INDEX_HITS: d.binding, ANALYTICS_SALT: SALT };
    await countIndexRequest(shardRequest(), { INDEX_HITS: d.binding }, NOW);
    await countIndexRequest(shardRequest(), { INDEX_HITS: d.binding, ANALYTICS_SALT: "short" }, NOW);
    await countIndexRequest(shardRequest(), { ANALYTICS_SALT: SALT }, NOW);
    await countIndexRequest(shardRequest("/index/vitest.json", { "User-Agent": "ludion-ai/0.1.4" }), ok, NOW);
    await countIndexRequest(shardRequest("/index/vitest.json", undefined, "POST"), ok, NOW);
    await countIndexRequest(shardRequest("/index.json"), ok, NOW);
    await countIndexRequest(shardRequest("/index/vitest.json?x=" + "a".repeat(10)), ok, NOW);
    expect(d.points).toHaveLength(1); // the last one has a query string, which doesn't change the path
    expect(d.points[0]!.blobs![1]).toBe("/index/vitest.json");
  });

  it("never throws, even when the dataset does", async () => {
    const throwing = { writeDataPoint: () => { throw new Error("quota"); } } as unknown as AnalyticsEngineDataset;
    await expect(countIndexRequest(shardRequest(), { INDEX_HITS: throwing, ANALYTICS_SALT: SALT }, NOW)).resolves.toBeUndefined();
  });
});

describe("the Worker around it", () => {
  const assets = (res: () => Response) => ({ fetch: async () => res() }) as unknown as Fetcher;
  function run(env: Partial<Env>, path: string, init?: RequestInit) {
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
    const req = new Request(`https://ludion.ai${path}`, init ?? { headers: { "CF-Connecting-IP": "203.0.113.7", "User-Agent": "ludion-ai/0.1.4" } });
    return { res: createApp().fetch(req, { SITE_URL: "https://ludion.ai", ...env } as Env, ctx), done: () => Promise.all(pending) };
  }

  it("answers a shard from the assets with its own headers, and counts it after answering", async () => {
    const d = dataset();
    const { res, done } = run({ ASSETS: assets(() => Response.json({ ok: 1 })), INDEX_HITS: d.binding, ANALYTICS_SALT: SALT }, "/index/vitest.json");
    const r = await res;
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: 1 });
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    await done();
    expect(d.points).toHaveLength(1);
  });

  it("doesn't count a shard that isn't there", async () => {
    const d = dataset();
    const { res, done } = run({ ASSETS: assets(() => new Response("no", { status: 404 })), INDEX_HITS: d.binding, ANALYTICS_SALT: SALT }, "/index/nope.json");
    expect((await res).status).toBe(404);
    await done();
    expect(d.points).toHaveLength(0);
  });

  it("still serves the shard when the secret is missing", async () => {
    const d = dataset();
    const { res, done } = run({ ASSETS: assets(() => Response.json({ ok: 1 })), INDEX_HITS: d.binding }, "/index/vitest.json");
    expect((await res).status).toBe(200);
    await done();
    expect(d.points).toHaveLength(0);
  });

  it("serves the real built shards through the real Worker", async () => {
    const subjects = await exports.default.fetch(new Request("https://ludion.ai/index/subjects.json"));
    expect(subjects.status).toBe(200);
    const names = Object.keys(((await subjects.json()) as { subjects: Record<string, unknown> }).subjects);
    expect(names.length).toBeGreaterThan(0);
    const shard = await exports.default.fetch(new Request(`https://ludion.ai/index/${names[0]}.json`));
    expect(shard.status).toBe(200);
  });
});
