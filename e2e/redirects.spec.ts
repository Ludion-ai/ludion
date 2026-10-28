import { expect, test } from "@playwright/test";
import { redirects } from "./pages.ts";

function pathnameOf(location: string): string {
  return new URL(location, "http://127.0.0.1").pathname;
}

for (const [from, target] of redirects) {
  test(`${from} redirects to ${target}`, async ({ request }) => {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    const pathname = pathnameOf(response.headers().location ?? "");
    if (target === "/") expect(pathname).toBe("/");
    else expect(pathname).toBe(target);
  });
}

test("the ended 0.1.x lesson and MCP endpoints answer 410 with the reason", async ({ request }) => {
  for (const path of ["/index.json", "/index/subjects.json", "/mcp"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(410);
    expect((await response.json()).error, path).toBe("ended");
  }
});

// Teacher pages were removed. Under wrangler dev, /@ludion-ai returns 301 Location /start/ and the redirect is not followed.
test("/@ludion-ai redirects to setup", async ({ request }) => {
  const response = await request.get("/@ludion-ai", { maxRedirects: 0 });
  expect(response.status()).toBe(301);
  expect(pathnameOf(response.headers().location ?? "")).toBe("/start/");
});
