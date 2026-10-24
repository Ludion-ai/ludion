// Runs inside workerd (@cloudflare/vitest-plugin) against the Worker from wrangler.jsonc and the built site.
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const get = (path: string, init?: RequestInit) => exports.default.fetch(new Request(`https://ludion.ai${path}`, init));

/** Location may be a path or an absolute URL. Compare the path only. */
function locationPath(res: Response): string {
  return new URL(res.headers.get("Location")!, "https://ludion.ai").pathname;
}

interface IndexJson {
  lessons: { id: string; teacher: string }[];
  teachers: Record<string, { login: string }>;
}

async function builtIndex(): Promise<IndexJson> {
  const res = await get("/index.json");
  expect(res.status).toBe(200);
  return res.json();
}

describe("worker", () => {
  it("serves index.json to any origin", async () => {
    const res = await get("/index.json");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await res.json() as { version: number }).version).toBe(1);
  });

  it("redirects every lesson page in the index to /start/ (lesson pages were removed)", async () => {
    const { lessons } = await builtIndex();
    for (const l of lessons) {
      const res = await get(`/lessons/${l.id}/`, { redirect: "manual" });
      expect(res.status, l.id).toBe(301);
      expect(locationPath(res), l.id).toBe("/start/");
    }
  });

  it("redirects a lesson URL without the trailing slash straight to /start/ with a 301", async () => {
    const { lessons } = await builtIndex();
    if (lessons.length === 0) return;
    const res = await get(`/lessons/${lessons[0]!.id}`, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(locationPath(res)).toBe("/start/");
  });

  it("redirects /@<login> in any case to /start/ (teacher pages were removed)", async () => {
    const { teachers } = await builtIndex();
    for (const { login } of Object.values(teachers)) {
      for (const variant of [login, login.toUpperCase(), `${login.toLowerCase()}/`]) {
        const res = await get(`/@${variant}`, { redirect: "manual" });
        expect(res.status, variant).toBe(301);
        expect(locationPath(res), variant).toBe("/start/");
      }
    }
  });

  it("redirects an unknown teacher to /start/ (teacher pages were removed)", async () => {
    const res = await get("/@nobody-has-this-login-0", { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(locationPath(res)).toBe("/start/");
  });

  it("gives the 404 page for an invalid login or an unknown page", async () => {
    for (const path of ["/@bad_login!", "/no-such-page/"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toContain("No page here.");
    }
  });

  it("sets nosniff on Worker responses and static assets", async () => {
    const { teachers } = await builtIndex();
    const login = Object.values(teachers)[0]?.login ?? "nobody";
    for (const path of ["/", "/index.json", `/@${login}`, "/@nobody-has-this-login-0"]) {
      expect((await get(path)).headers.get("X-Content-Type-Options"), path).toBe("nosniff");
    }
  });

  it("sends HSTS for a year on every response, without includeSubDomains or preload", async () => {
    for (const path of ["/", "/index.json", "/mcp", "/@nobody-has-this-login-0"]) {
      expect((await get(path)).headers.get("Strict-Transport-Security"), path).toBe("max-age=31536000");
    }
  });
});
