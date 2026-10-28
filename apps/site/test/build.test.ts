import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("_headers", () => {
  it("sends HSTS for a year on every static asset, without includeSubDomains or preload", () => {
    const text = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
    const all = text;
    expect(all.startsWith("/*\n")).toBe(true);
    expect(all).toContain("  Strict-Transport-Security: max-age=31536000\n");
  });

  it("lets in only Google Analytics' origins beyond the site's own, and never inline scripts", () => {
    const text = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
    const csp = Object.fromEntries(
      text.match(/Content-Security-Policy: (.*)/)![1]!.split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]),
    );
    expect(csp["script-src"]).toEqual(["'self'", "https://www.googletagmanager.com"]);
    expect(csp["connect-src"]).toEqual(["'self'", "https://www.googletagmanager.com", "https://*.google-analytics.com", "https://*.google.com"]);
    expect(csp["img-src"]).toEqual(["'self'", "data:", "https://www.googletagmanager.com", "https://*.google-analytics.com"]);
    expect(csp["default-src"]).toEqual(["'self'"]);
  });
});
