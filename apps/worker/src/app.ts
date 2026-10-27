import { Hono } from "hono";

export interface Env {
  ASSETS: Fetcher;
  SITE_URL: string;
}

export const HSTS = "max-age=31536000";

const TEACHER_PATH = /^\/@[A-Za-z0-9-]{1,39}\/?$/;

/**
 * The lesson data and MCP endpoints of ludion-ai 0.1.x ended on 2026-10-28 (docs/design.md, cleanup). Old clients
 * get a fixed 410 that says why, for 90 days; then these routes go too.
 */
export const ENDED = {
  error: "ended",
  message: "Ludion's lesson data and MCP server ended on 2026-10-28. Ludion is now a security-update tool: https://ludion.ai",
};

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

  for (const path of ["/mcp", "/mcp/*", "/index.json", "/index/*"]) {
    app.all(path, (c) => c.json(ENDED, 410, { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" }));
  }

  // Teacher pages were removed with the lessons.
  app.get("*", async (c, next) => {
    if (!TEACHER_PATH.test(new URL(c.req.url).pathname)) return next();
    return c.redirect("/start/", 301);
  });

  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
  return app;
}
