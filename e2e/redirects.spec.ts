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

test("a subject page sends people to sync setup", async ({ request }) => {
  const response = await request.get("/vitest/", { maxRedirects: 0 });
  const location = response.headers().location ?? "";
  if (response.status() === 301) {
    expect(pathnameOf(location)).toBe("/start/");
    return;
  }
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toMatch(/http-equiv=["']refresh["'][^>]*url=\/start\//i);
});

test("the lesson index is still JSON", async ({ request }) => {
  for (const path of ["/index.json", "/index/subjects.json"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"] ?? "", path).toContain("json");
    expect(await response.json()).toBeTruthy();
  }
});

// The worker rewrites /@login to an assets fetch of /teachers/<login>/. That fetch follows the
// _redirects 301 and returns the /start/ document with status 200, so the browser URL stays /@ludion-ai.
// apps/worker is not ours to change. See apps/worker/test/app.test.ts ("serves /@<login>").
test.fixme("/@ludion-ai ends at sync setup", async ({ page }) => {
  const response = await page.goto("/@ludion-ai");
  await expect(page).toHaveURL(/\/start\/?$/);
  expect(response?.ok()).toBeTruthy();
});
