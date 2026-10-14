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
  await page.goto("/bench/#recorded-answer");
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

test("without JavaScript, both recorded answers and home setup remain available", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled:false });
  const page = await context.newPage();
  await page.goto("/bench/#recorded-answer");
  await expect(page.locator('[data-answer="without"]')).toBeVisible();
  await expect(page.locator('[data-answer="with"]')).toBeVisible();
  await page.goto("/");
  await expect(page.locator('[data-moment-answer="without"]')).toBeVisible();
  await expect(page.locator('[data-moment-answer="with"]')).toBeVisible();
  await expect(page.getByRole("link",{name:"Get started",exact:true})).toHaveAttribute("href","/start/");
  await context.close();
});

test("home replays recorded answers without changing the installed version or jumping the page", async ({page,request}) => {
  await page.clock.install();
  for (const width of [320,390,1280]) {
    await page.setViewportSize({width,height:900});
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const moment = page.locator("[data-moment]");
    const before = moment.locator('[data-moment-answer="without"]');
    const after = moment.locator('[data-moment-answer="with"]');
    const initial = await moment.boundingBox();
    await expect(after).toBeVisible();
    await moment.getByRole("button",{name:"Without sync",exact:true}).press("Enter");
    await expect(before).toBeVisible();
    await expect(before).toContainText("Yes. Inline projects");
    expect((await moment.boundingBox())!.height).toBeCloseTo(initial!.height,0);
    const replay = moment.getByRole("button",{name:"Replay recorded change",exact:true});
    await replay.focus();
    await replay.press("Enter");
    await expect(replay).toBeDisabled();
    await page.clock.runFor(1000);
    await expect(replay).toBeFocused();
    await expect(after).toBeVisible();
    await expect(before).toBeHidden();
    await expect(after).toContainText("No. On the vitest 5.0.3");
    await expect(moment.locator(".version")).toHaveText("vitest5.0.3");
    await expect(moment.getByRole("button",{name:"With sync",exact:true})).toHaveAttribute("aria-pressed","true");
    expect((await moment.boundingBox())!.height).toBeCloseTo(initial!.height,0);
    await page.emulateMedia({reducedMotion:"reduce"});
    await moment.getByRole("button",{name:"Without sync",exact:true}).click();
    await replay.press("Enter");
    await expect(after).toBeVisible();
    await expect(replay).toBeEnabled();
    await expect(moment).not.toHaveClass(/delivering/);
    for (const panel of [before,after]) expect((await request.get((await panel.locator("a").getAttribute("href"))!)).status()).toBe(200);
    await page.emulateMedia({reducedMotion:"no-preference"});
  }
});

test("switching recorded answers keeps the page position stable at each layout", async ({page}) => {
  for (const width of [320,390,1280]) {
    await page.setViewportSize({width,height:900});
    await page.goto("/bench/#recorded-answer");
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
  await expect(page.locator("[data-context-stage]")).not.toHaveClass(/active/);
  await page.clock.runFor(300);
  // Sample a broad area above the artwork. The quiet corner can quantize to identical pixels in two frames.
  const clip = {x:320,y:64,width:640,height:128};
  const first = await page.screenshot({clip});
  await page.clock.runFor(1200);
  expect((await page.screenshot({clip})).equals(first)).toBe(true);
  await page.emulateMedia({reducedMotion:"no-preference"});
  await expect(page.locator("[data-context-stage]")).toHaveClass(/active/);
  await page.clock.runFor(1200);
  expect((await page.screenshot({clip})).equals(first)).toBe(false);
});

test("home opens with a visual scene and reveals the recorded app after scrolling", async ({page}) => {
  await page.emulateMedia({reducedMotion:"no-preference"});
  for (const width of [320,390,1280]) {
    await page.setViewportSize({width,height:900});
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const stage = page.locator("[data-context-stage]");
    await expect(stage).toHaveClass(/active/);
    const scene = page.locator("[data-context-projection]");
    const initial = await scene.evaluate(el => getComputedStyle(el).getPropertyValue("--scroll"));
    const record = page.locator("#in-context");
    expect((await record.boundingBox())!.y).toBeGreaterThanOrEqual(900);
    await page.getByRole("link",{name:"See it work",exact:true}).click();
    await expect(page).toHaveURL(/#in-context$/);
    await expect.poll(async () => (await record.boundingBox())!.y).toBeCloseTo(40,0);
    await expect(stage).not.toHaveClass(/active/);
    await expect(page.locator("[data-moment]")).toBeVisible();
    // Re-enter the artwork: a scroll-linked transform must move, while reduced motion resets it.
    await stage.scrollIntoViewIfNeeded();
    await expect(stage).toHaveClass(/active/);
    await page.mouse.wheel(0,250);
    await expect.poll(() => scene.evaluate(el => getComputedStyle(el).getPropertyValue("--scroll"))).not.toBe(initial);
    await page.emulateMedia({reducedMotion:"reduce"});
    await expect(stage).not.toHaveClass(/active/);
    await expect.poll(() => scene.evaluate(el => el.getAttribute("style") ?? "")).not.toContain("--scroll");
    await page.emulateMedia({reducedMotion:"no-preference"});
  }
});
