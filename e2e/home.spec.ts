import { expect, test } from "@playwright/test";

test("setup copies the actual sync command and opens privacy details by keyboard", async ({page,context}) => {
  await context.grantPermissions(["clipboard-read","clipboard-write"]);
  await page.goto("/start/");
  const copy = page.getByRole("button",{name:"Copy: npx ludion-ai sync",exact:true});
  await copy.click();
  await expect(copy).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("npx ludion-ai sync");
  const privacy = page.locator("details").filter({has:page.getByText("What leaves your machine",{exact:true})});
  await privacy.locator("summary").press("Enter");
  await expect(privacy).toHaveAttribute("open", "");
  await expect(privacy).toContainText("Cloudflare");
});

test("the recorded comparison switches answers and keeps each full answer reachable", async ({ page, request }) => {
  await page.goto("/");
  const comparison = page.locator("[data-comparison]");
  await expect(comparison.getByRole("button", { name:"With sync", exact:true })).toHaveAttribute("aria-pressed","true");
  const before = comparison.locator('[data-answer="without"]');
  const after = comparison.locator('[data-answer="with"]');
  await expect(after).toBeVisible();
  await expect(before).toBeHidden();
  await comparison.getByRole("button", { name:"Without sync", exact:true }).click();
  await expect(before).toBeVisible();
  await expect(after).toBeHidden();
  await expect(before.locator("blockquote")).toContainText("Yes. Inline projects");
  await comparison.getByRole("button", { name:"With sync", exact:true }).press("Enter");
  await expect(after).toBeVisible();
  await expect(after.locator("blockquote")).toContainText("No. On the vitest 5.0.3");
  for (const answer of [before,after]) {
    const url = await answer.locator("a").getAttribute("href");
    expect((await request.get(url!)).status()).toBe(200);
  }
});

test("without JavaScript, both recorded answers and setup remain available", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled:false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator('[data-answer="without"]')).toBeVisible();
  await expect(page.locator('[data-answer="with"]')).toBeVisible();
  await expect(page.getByRole("link",{name:"Get started",exact:true})).toHaveAttribute("href","/start/");
  await context.close();
});

test("switching recorded answers keeps the page position stable at each layout", async ({page}) => {
  for (const width of [320,390,1280]) {
    await page.setViewportSize({width,height:900});
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const comparison = page.locator("[data-comparison]");
    const before = await comparison.boundingBox();
    await comparison.getByRole("button",{name:"Without sync",exact:true}).click();
    const after = await comparison.boundingBox();
    expect(after?.height,`${width}px comparison height`).toBeCloseTo(before!.height,0);
    await expect(comparison.locator('[data-answer="with"]')).toBeHidden();
  }
});

test("changing reduced motion stops and resumes the wave without reloading", async ({ page }) => {
  await page.clock.install();
  await page.emulateMedia({reducedMotion:"no-preference"});
  await page.goto("/");
  test.skip(!(await page.locator("html").getAttribute("class"))?.includes("has-water"),"WebGL unavailable");
  await page.evaluate(() => document.fonts.ready);
  await page.clock.runFor(1200);
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.clock.runFor(300);
  const clip = {x:0,y:0,width:320,height:64};
  const first = await page.screenshot({clip});
  await page.clock.runFor(1200);
  expect((await page.screenshot({clip})).equals(first)).toBe(true);
  await page.emulateMedia({reducedMotion:"no-preference"});
  await page.clock.runFor(1200);
  expect((await page.screenshot({clip})).equals(first)).toBe(false);
});
