// Counts requests for the index shards, to answer one question: how many distinct clients run `ludion sync`?
// What is written per request: the UTC day, the shard's path, the CLI's version (from its User-Agent), and a key.
// The key is an HMAC of (day, IP, User-Agent) under a secret, so it is different every day and can't be reversed, without the secret,
// by trying addresses. The IP is never written, and neither is any User-Agent but the CLI's own (`ludion-ai/<version>`). docs/decisions.md, "Counting index requests".

export interface CountEnv {
  /** Analytics Engine dataset (wrangler.jsonc). */
  INDEX_HITS?: AnalyticsEngineDataset;
  /** Worker secret, at least MIN_SALT_LENGTH characters. Without it nothing is counted. */
  ANALYTICS_SALT?: string;
}

/** /index/subjects.json and /index/<subject>.json: what `ludion sync` downloads. */
export const SHARD_PATH = /^\/index\/[A-Za-z0-9._-]{1,100}\.json$/;
/** The User-Agent the CLI sends since 0.1.4 (packages/cli/src/shards.ts). Anything else is "other". */
const CLI_USER_AGENT = /^ludion-ai\/(\d{1,3}\.\d{1,3}\.\d{1,3})$/;
export const MIN_SALT_LENGTH = 32;
export const OTHER_CLIENT = "other";

export function clientLabel(userAgent: string | null): string {
  const m = CLI_USER_AGENT.exec(userAgent ?? "");
  return m ? `ludion-ai/${m[1]}` : OTHER_CLIENT;
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** 128 bits of HMAC-SHA-256 over the day, the address and the User-Agent; the day is in the input, so keys don't link days. */
export async function clientKey(salt: string, day: string, ip: string, userAgent: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${day}\n${ip}\n${userAgent}`));
  return hex(mac).slice(0, 32);
}

/**
 * Records one shard request. Never throws and never delays the response (call it inside waitUntil): a count must not
 * be able to break `ludion sync`. Counts nothing when the secret is missing or short, when there is no client address,
 * or when the request isn't a GET for a shard.
 */
export async function countIndexRequest(request: Request, env: CountEnv, now: Date = new Date()): Promise<void> {
  try {
    const dataset = env.INDEX_HITS;
    const salt = env.ANALYTICS_SALT;
    if (!dataset || !salt || salt.length < MIN_SALT_LENGTH || request.method !== "GET") return;
    const path = new URL(request.url).pathname;
    const ip = request.headers.get("CF-Connecting-IP");
    if (!SHARD_PATH.test(path) || !ip) return;
    const userAgent = request.headers.get("User-Agent") ?? "";
    const day = now.toISOString().slice(0, 10);
    dataset.writeDataPoint({ indexes: [await clientKey(salt, day, ip, userAgent)], blobs: [day, path, clientLabel(userAgent)] });
  } catch (err) {
    console.error(`index count failed: ${err instanceof Error ? err.name : "error"}`);
  }
}
