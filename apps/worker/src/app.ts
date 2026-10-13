import { Hono } from "hono";
import { countIndexRequest, type CountEnv } from "./index-counts.ts";
import { handleMcp } from "./mcp/server.ts";

export interface Env extends CountEnv {
  ASSETS: Fetcher;
  SITE_URL: string;
}

export const HSTS = "max-age=31536000";

const TEACHER_PATH = /^\/@([A-Za-z0-9-]{1,39})\/?$/;

export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.use("*", async (c, next) => {
    await next();
    // Responses from env.ASSETS have immutable headers; copy before adding ours.
    c.res = new Response(c.res.body, c.res);
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    // HTTPS only, for a year. No includeSubDomains or preload: they are hard to undo (docs/decisions.md, "Deploy safety").
    c.res.headers.set("Strict-Transport-Security", HSTS);
  });

  // MCP over Streamable HTTP, stateless; OPTIONS for CORS preflight from browser-based clients.
  app.on(["GET", "POST", "DELETE", "OPTIONS"], "/mcp", (c) => handleMcp(c.req.raw, c.env, c.executionCtx as ExecutionContext));

  // The index shards are static assets; the Worker runs for them (wrangler.jsonc, run_worker_first) only to count the
  // request, after the response is built and without waiting for the count.
  app.get("/index/*", async (c) => {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    if (res.ok) c.executionCtx.waitUntil(countIndexRequest(c.req.raw, c.env));
    return res;
  });

  // /@<login> serves the teacher page at the lowercase login. Unknown teachers get the 404 page.
  app.get("*", async (c, next) => {
    const m = TEACHER_PATH.exec(new URL(c.req.url).pathname);
    if (!m) return next();
    const target = new URL(`/teachers/${m[1]!.toLowerCase()}/`, c.req.url);
    return c.env.ASSETS.fetch(new Request(target, c.req.raw));
  });

  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
  return app;
}
