// Runs inside workerd (@cloudflare/vitest-plugin) against the Worker from wrangler.jsonc and the built site.
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const get = (path: string, init?: RequestInit) => exports.default.fetch(new Request(`https://ludion.ai${path}`, init));

/** Location may be a path or an absolute URL. Compare the path only. */
function locationPath(res: Response): string {
  return new URL(res.headers.get("Location")!, "https://ludion.ai").pathname;
}

describe("worker", () => {
  it("serves the home page", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("answers the ended 0.1.x lesson and MCP endpoints with a 410 that says why, to any origin", async () => {
    for (const [path, method] of [["/index.json", "GET"], ["/index/subjects.json", "GET"], ["/index/vitest.json", "GET"], ["/mcp", "POST"], ["/mcp", "GET"], ["/mcp/x", "GET"]] as const) {
      const res = await get(path, { method, ...(method === "POST" ? { body: "{}" } : {}) });
      expect(res.status, path).toBe(410);
      expect(res.headers.get("Access-Control-Allow-Origin"), path).toBe("*");
      const body = await res.json() as { error: string; message: string };
      expect(body.error, path).toBe("ended");
      expect(body.message, path).toContain("https://ludion.ai");
    }
  });

  it("redirects old lesson pages and /@<login> to /start/", async () => {
    for (const path of ["/lessons/01M4N4KZ0QT41TY27SW0E683RX/", "/@ludion-ai", "/@Ludion-AI/", "/vitest/"]) {
      const res = await get(path, { redirect: "manual" });
      expect(res.status, path).toBe(301);
      expect(locationPath(res), path).toBe("/start/");
    }
  });

  it("gives the 404 page for an invalid login or an unknown page", async () => {
    for (const path of ["/@bad_login!", "/no-such-page/"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toContain("No page here.");
    }
  });

  it("serves build.json, the deploy check's marker", async () => {
    const res = await get("/build.json");
    expect(res.status).toBe(200);
    expect(Number.isFinite(Date.parse((await res.json() as { built_at: string }).built_at))).toBe(true);
  });

  it("sets nosniff and a year of HSTS (no includeSubDomains or preload) on every response", async () => {
    for (const path of ["/", "/index.json", "/mcp", "/@ludion-ai", "/no-such-page/"]) {
      const res = await get(path, { redirect: "manual" });
      expect(res.headers.get("X-Content-Type-Options"), path).toBe("nosniff");
      expect(res.headers.get("Strict-Transport-Security"), path).toBe("max-age=31536000");
    }
  });
});
