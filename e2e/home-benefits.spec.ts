import { readFileSync } from "node:fs";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import semver from "semver";
import type { IndexEntry } from "@ludion/core";
import { DATA_LINE } from "../packages/cli/src/render.ts";
import { COVERAGE_LINE } from "@ludion/core";

const EXTENDS = "01M4N4KZ0QT41TY27SW0E683RX";
const CONFIG = "01M4N6Y54270A8AKTMH9SVGV32";
const RESTORE = "01M4T6BQ9DJH2BCV6Q28GH4HJ1";

test("home selection reflects actual versions and measured pruning without moving the workspace", async ({page,request}) => {
  const shard = (await (await request.get("/index/vitest.json")).json()) as {lessons:(IndexEntry & {models?:Record<string,"knows"|"misses">})[]};
  const expected = (version:string,model:string) => {
    const matching = shard.lessons.filter(lesson => semver.satisfies(version,lesson.version!,{includePrerelease:true}));
    return {total:shard.lessons.length,matching:matching.length,included:matching.filter(lesson=>lesson.models?.[model]!=="knows").length};
  };
  for (const width of [320,390,1280]) {
    await page.setViewportSize({width,height:900});
    await page.emulateMedia({colorScheme:width===390?"dark":"light",reducedMotion:"reduce"});
    await page.goto("/");
    await page.evaluate(()=>document.fonts.ready);
    const lens = page.locator("[data-project-lens]");
    const project = lens.locator("[data-lens-project]");
    const model = lens.locator("[data-lens-model]");
    const selected = lens.locator("[data-lens-case]:not([hidden])");
    await expect(selected).toHaveCount(1);
    await expect(project).toHaveValue("vitest-5");
    await expect(model).toHaveValue("claude-haiku-5-5");
    // Evidence is a native disclosure; the diagram is the default view.
    await expect(selected.locator("[data-lens-inspection]")).not.toHaveAttribute("open", "");
    await selected.locator("[data-lens-inspection] > summary").press("Enter");
    await expect(selected.locator("[data-lens-inspection]")).toHaveAttribute("open", "");
    // Native details queues a toggle task. Measure after the synchronized cases
    // have expanded so the test checks selection stability, not that task's timing.
    await expect(lens.locator("[data-lens-inspection]:not([open])")).toHaveCount(0);
    const initial = (await lens.boundingBox())!;
    const haiku = expected("5.0.3","claude-haiku-5-5");
    const opus = expected("5.0.3","claude-opus-5-5");
    await expect(selected.locator(".selection-flow b")).toHaveText([String(haiku.total),String(haiku.matching),String(haiku.included)]);
    expect(haiku.included).toBe(opus.included-1);
    await selected.locator(`[data-lens-select="${CONFIG}"]`).press("Enter");
    const pruned = selected.locator(`[data-lens-lesson="${CONFIG}"]`);
    await expect(pruned).toBeVisible();
    await expect(pruned.locator(".lesson-state")).toContainText("Left out for this model");
    await expect(pruned.locator(".verdict")).toHaveText("Measured knows · left out");
    await selected.locator(`[data-lens-select="${EXTENDS}"]`).press("Enter");
    await expect(selected.locator(`[data-lens-lesson="${EXTENDS}"] .generated-claim`)).toHaveText(shard.lessons.find(lesson=>lesson.id===EXTENDS)!.claim);
    await selected.locator(`[data-lens-select="${RESTORE}"]`).press("Enter");
    await expect(selected.locator(`[data-lens-lesson="${RESTORE}"] .verdict`)).toHaveText("Not measured · included");
    await expect(selected.locator(`[data-lens-lesson="${RESTORE}"] .signature`)).toContainText("drafted by an agent");
    await expect(selected.locator(`[data-lens-lesson="${RESTORE}"] .signature .by`)).toContainText(`@${shard.lessons.find(lesson=>lesson.id===RESTORE)!.teacher}`);
    expect((await lens.boundingBox())!.height).toBeCloseTo(initial.height,0);
    await model.focus();
    await model.selectOption("claude-opus-5-5");
    await expect(model).toBeFocused();
    await expect(selected).toHaveAttribute("data-model","claude-opus-5-5");
    await expect(selected.locator(".selection-flow b")).toHaveText([String(opus.total),String(opus.matching),String(opus.included)]);
    await selected.locator(`[data-lens-select="${CONFIG}"]`).press("Enter");
    const includedConfig = selected.locator(`[data-lens-lesson="${CONFIG}"]`);
    await expect(includedConfig).toBeVisible();
    await expect(includedConfig.locator(".lesson-state")).toContainText("Included in context");
    await expect(includedConfig.locator(".verdict")).toHaveText("Measured misses");
    expect((await lens.boundingBox())!.height).toBeCloseTo(initial.height,0);
    await project.selectOption("vitest-4");
    const older = expected("4.0.0","claude-opus-5-5");
    await expect(selected.locator(".selection-flow b")).toHaveText([String(older.total),String(older.matching),String(older.included)]);
    await expect(selected.locator(`[data-lens-lesson="${EXTENDS}"]`)).toHaveCount(0);
    await expect(selected.locator(`[data-lens-lesson="${RESTORE}"]`)).toBeVisible();
    expect((await lens.boundingBox())!.height).toBeCloseTo(initial.height,0);
    await expect(lens.locator(".lens-scope")).toContainText("Current-index example for one package");
    await expect(lens.locator(".lens-scope")).toContainText("Coverage is partial");
    await expect(lens.locator(".lens-scope")).toContainText("without tools");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});

test("lesson inspector follows evidence by keyboard while the literal claim is available and attribution stays visible", async ({page,request}) => {
  const index = (await (await request.get("/index.json")).json()) as {lessons:IndexEntry[]};
  const lesson = index.lessons.find(lesson=>lesson.id===EXTENDS)!;
  const excerpt = readFileSync("docs/demo/grep-output.txt","utf8").trim();
  for (const width of [390,1280]) {
    await page.setViewportSize({width,height:900});
    await page.emulateMedia({colorScheme:width===390?"dark":"light",reducedMotion:"reduce"});
    await page.goto("/");
    await page.evaluate(()=>document.fonts.ready);
    const trace = page.locator("[data-lesson-trace]");
    const current = trace.locator("[data-trace-panel]:not([hidden])");
    await expect(trace.locator(".trace-claim")).not.toHaveAttribute("open", "");
    await expect(trace.locator(".trace-signature")).toBeVisible();
    await trace.locator(".trace-claim > summary").press("Enter");
    await expect(trace.locator(".generated-claim")).toBeVisible();
    await trace.locator("[data-trace-controls]").scrollIntoViewIfNeeded();
    const initial = (await trace.boundingBox())!;
    await trace.locator('[data-trace-step="change"]').focus();
    for (const [step,key] of [["evidence","ArrowRight"],["teacher","ArrowDown"],["context","End"],["change","Home"]] as const) {
      const tab = trace.locator(`[data-trace-step="${step}"]`);
      const tabTop = (await tab.boundingBox())!.y;
      await trace.locator("[data-trace-step]:focus").press(key);
      await expect(current).toHaveAttribute("data-trace-panel",step);
      await expect(trace.locator(`[data-trace-step="${step}"]`)).toBeFocused();
      await expect(trace.locator(`[data-trace-step="${step}"]`)).toHaveAttribute("aria-pressed","true");
      await expect(trace.locator(".generated-claim")).toHaveText(lesson.claim);
      await expect(trace.locator(".trace-signature")).toContainText(`@${lesson.teacher}`);
      await expect(trace.locator(".trace-signature")).toContainText("drafted by an agent");
      // Desktop reserves a fixed workspace. Mobile panels fit their own content;
      // switching must preserve the selected control's position and focus.
      if (width === 1280) expect((await trace.boundingBox())!.height).toBeCloseTo(initial.height,0);
      else expect((await tab.boundingBox())!.y).toBeCloseTo(tabTop,0);
      if (step==="evidence") {
        await expect(current).toContainText("Must fail, printing");
        await expect(current).toContainText("Must pass");
        await expect(current.locator(".panel-note")).toContainText("not a live test run");
        const evidence = lesson.evidence.find(evidence=>"source" in evidence)!;
        if ("source" in evidence) await expect(current.locator("blockquote")).toHaveText(evidence.source.quote);
      }
      if (step==="teacher") await expect(current).toContainText(String(lesson.teacher_id));
      if (step==="context") {
        await expect(current.locator("pre code")).toHaveText(excerpt);
        await expect(current.locator(".panel-note")).toContainText("9 lessons; 2 dependencies had no coverage");
      }
    }
    const contextTab = trace.locator('[data-trace-step="context"]');
    const contextTop = (await contextTab.boundingBox())!.y;
    await contextTab.press("Enter");
    await expect(current).toHaveAttribute("data-trace-panel","context");
    await expect(contextTab).toBeFocused();
    if (width === 1280) expect((await trace.boundingBox())!.height).toBeCloseTo(initial.height,0);
    else expect((await contextTab.boundingBox())!.y).toBeCloseTo(contextTop,0);
  }
});

test("assistant connection keeps actual conditional wiring, native focus, and exact clipboard bytes", async ({page,context}) => {
  await context.grantPermissions(["clipboard-read","clipboard-write"]);
  await page.emulateMedia({reducedMotion:"reduce",colorScheme:"dark"});
  await page.setViewportSize({width:390,height:900});
  await page.goto("/");
  const delivery = page.locator("[data-delivery]");
  const routes = [
    {id:"claude",file:"CLAUDE.md",code:"@.ludion/lessons.md",note:"created if missing"},
    {id:"codex",file:"AGENTS.md",code:"Before writing code that uses this project's packages, read `.ludion/lessons.md`: changes in the installed versions that you may not know.",note:"when AGENTS.md exists"},
    {id:"cursor",file:".cursor/rules/ludion.mdc",code:`---\ndescription: Changes in this project's installed package versions (written by ludion sync)\nalwaysApply: true\n---\n\n# Lessons from Ludion\n\n${DATA_LINE}\n\n${COVERAGE_LINE}`,note:"When .cursor exists"},
  ];
  for (const route of routes) {
    const button = delivery.locator(`[data-delivery-target="${route.id}"]`);
    await button.press("Enter");
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-pressed","true");
    const panel = delivery.locator("[data-wiring-route]:not([hidden])");
    await expect(panel).toHaveCount(1);
    await expect(panel.locator(".file-bar code")).toHaveText(route.file);
    await expect(panel.locator(".wiring-details")).not.toHaveAttribute("open", "");
    await panel.locator(".wiring-details > summary").press("Enter");
    await expect(panel.locator("pre code")).toBeVisible();
    expect(await panel.locator("pre code").textContent()).toBe(route.code);
    await expect(panel.locator("p")).toContainText(route.note);
    await expect(delivery.locator("[data-delivery-replay]")).toHaveAttribute("aria-disabled","false");
    await expect(delivery.locator("[data-delivery-status]")).toContainText(route.file);
  }
  await expect(delivery.locator(".delivery-scope")).toContainText("not a CLI run");
  await expect(delivery.locator(".delivery-scope")).toContainText("No files are changed");
  await expect(delivery.locator(".delivery-scope")).toContainText("Coverage is partial");
  const copy = delivery.getByRole("button",{name:"Copy: npx ludion-ai sync",exact:true});
  await copy.press("Enter");
  await expect(copy).toBeFocused();
  await expect(copy).toHaveText("Copied");
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe("npx ludion-ai sync");
});

test("connection replay finishes, retains keyboard focus, and reduced motion stops the 3D movement", async ({page}) => {
  await page.clock.install();
  await page.emulateMedia({reducedMotion:"no-preference"});
  await page.goto("/");
  const delivery = page.locator("[data-delivery]");
  const visual = delivery.locator("[data-delivery-visual]");
  const replay = delivery.locator("[data-delivery-replay]");
  await visual.scrollIntoViewIfNeeded();
  await page.clock.runFor(2800);
  await expect(replay).toHaveAttribute("aria-disabled","false");
  await replay.press("Enter");
  await expect(delivery).toHaveAttribute("data-delivery-playing","true");
  await expect(replay).toHaveAttribute("aria-disabled","true");
  await page.clock.runFor(2800);
  await expect(replay).toBeFocused();
  await expect(delivery).toHaveAttribute("data-delivery-playing","false");
  await replay.press("Enter");
  await expect(delivery).toHaveAttribute("data-delivery-playing","true");
  await page.emulateMedia({reducedMotion:"reduce"});
  // MediaQuery changes arrive on a native render task. Wait for that task's
  // stopped state before advancing the mocked clock and sampling a stable pose.
  await expect.poll(() => page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await expect(delivery).toHaveAttribute("data-delivery-playing","false");
  await page.clock.runFor(100);
  await expect(replay).toHaveAttribute("aria-disabled","false");
  const source = delivery.locator(".source-file");
  const stable = await source.getAttribute("style");
  const box = (await visual.boundingBox())!;
  await page.mouse.move(box.x+box.width*.8,box.y+box.height*.2);
  await page.clock.runFor(1500);
  expect(await source.getAttribute("style")).toBe(stable);
  await replay.press("Enter");
  await expect(replay).toBeFocused();
  await expect(delivery).toHaveAttribute("data-delivery-playing","false");
  await page.emulateMedia({reducedMotion:"no-preference"});
  await replay.press("Enter");
  await expect(delivery).toHaveAttribute("data-delivery-playing","true");
  await page.locator("h1").scrollIntoViewIfNeeded();
  await page.clock.runFor(100);
  await expect(delivery).toHaveAttribute("data-delivery-playing","false");
});

test("without JavaScript the matching example, complete inspector and all wiring remain usable", async ({browser}) => {
  const context = await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:900},colorScheme:"light"});
  const page = await context.newPage();
  await page.goto("/");
  const lens = page.locator("[data-project-lens]");
  await expect(lens.locator("[data-lens-static]")).toBeVisible();
  await expect(lens.locator("[data-lens-project]")).toBeHidden();
  const current = lens.locator("[data-lens-case]:not([hidden])");
  await expect(current.locator("[data-lens-inspection]")).not.toHaveAttribute("open", "");
  await current.locator("[data-lens-inspection] > summary").press("Enter");
  await expect(current.locator(`[data-lens-lesson="${EXTENDS}"] .generated-claim`)).toBeVisible();
  const restore = current.locator(`[data-lens-lesson="${RESTORE}"]`);
  await restore.locator("summary").press("Enter");
  await expect(restore.locator(".generated-claim")).toBeVisible();
  await expect(restore.locator(".signature")).toContainText("drafted by an agent");
  const trace = page.locator("[data-lesson-trace]");
  await trace.locator(".trace-claim > summary").press("Enter");
  await expect(trace.locator(".generated-claim")).toBeVisible();
  await expect(trace.locator("[data-trace-controls]")).toBeHidden();
  for (const step of ["change","evidence","teacher","context"]) await expect(trace.locator(`[data-trace-panel="${step}"]`)).toBeVisible();
  await expect(trace.locator('[data-trace-panel="context"] .panel-note')).toContainText("2 dependencies had no coverage");
  const delivery = page.locator("[data-delivery]");
  await expect(delivery.locator(".fallback-route")).toBeVisible();
  await expect(delivery.locator(".destinations")).toBeHidden();
  await expect(delivery.locator("[data-delivery-copy]")).toBeHidden();
  for (const route of ["claude","codex","cursor"]) {
    const panel = delivery.locator(`[data-wiring-route="${route}"]`);
    await expect(panel).toBeVisible();
    await panel.locator(".wiring-details > summary").press("Enter");
    await expect(panel.locator("pre code")).toBeVisible();
  }
  await expect(delivery.getByRole("link",{name:"Setup guide",exact:true})).toHaveAttribute("href","/start/");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await context.close();
});

test("mobile advanced evidence and Cursor states keep full-page WCAG targets and semantics", async ({page}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({width:390,height:900});
  const tags = ["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"];
  for (const colorScheme of ["light","dark"] as const) {
    await page.emulateMedia({colorScheme,reducedMotion:"reduce"});
    await page.goto("/");
    await page.evaluate(()=>document.fonts.ready);
    await page.locator("[data-lens-project]").selectOption("wrangler-current");
    await expect(page.locator("[data-lens-case]:not([hidden])")).toHaveAttribute("data-project","wrangler-current");
    await page.locator("[data-lens-case]:not([hidden]) [data-lens-inspection] > summary").click();
    // Native clicks auto-scroll each workspace into view. This also exercises nearby source links after ordinary chapter navigation.
    const evidence = page.locator('[data-trace-step="evidence"]');
    await evidence.click();
    await expect(evidence).toHaveAttribute("aria-pressed","true");
    await expect(page.locator('[data-trace-panel="evidence"]')).toBeVisible();
    await page.locator(".trace-claim > summary").click();
    const evidenceResult = await new AxeBuilder({page}).withTags(tags).analyze();
    expect(evidenceResult.violations.map(violation=>`${violation.id}: ${violation.help} (${violation.nodes.map(node=>node.target.join(" ")).join(", ")})`),`Evidence state (${colorScheme})`).toEqual([]);
    const cursor = page.locator('[data-delivery-target="cursor"]');
    await cursor.click();
    await expect(cursor).toHaveAttribute("aria-pressed","true");
    await expect(page.locator('[data-wiring-route="cursor"]')).toBeVisible();
    await page.locator('[data-wiring-route="cursor"] .wiring-details > summary').click();
    const cursorResult = await new AxeBuilder({page}).withTags(tags).analyze();
    expect(cursorResult.violations.map(violation=>`${violation.id}: ${violation.help} (${violation.nodes.map(node=>node.target.join(" ")).join(", ")})`),`Cursor state (${colorScheme})`).toEqual([]);
  }
});
