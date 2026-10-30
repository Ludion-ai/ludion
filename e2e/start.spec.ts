import { expect, test } from "@playwright/test";

test("security setup explains preview scope, copies the scan command, and makes apply opt-in", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/start/");
  await expect(page.locator("#scan-command")).toHaveText("node packages/cli/dist/cli.js scan --dir /path/to/app");
  await expect(page.locator("#source-command")).toContainText("npm run build -w ludion-ai");
  await expect(page.locator(".coverage")).toContainText("Production is not automatically redeployed");
  await expect(page.locator(".where")).toContainText("npm 0.1.4 release does not include these commands");
  await page.getByText("3 · Validate, then apply", { exact: true }).click();
  await expect(page.locator("#patch-command")).not.toContainText("--apply");
  await expect(page.locator("#apply-command")).toContainText("--apply");
  // --apply commits each fix on its own branch; the site must not say it rewrites the project in place (#204).
  await expect(page.locator(".apply-branches")).toContainText("does not change your files or your current branch");
  await expect(page.locator(".apply-branches")).toContainText("ludion/<ecosystem>/<package>-<version>");
  await expect(page.locator(".apply-branches")).toContainText("Fixes that pass only together are not applied");
  await expect(page.locator(".apply-branches")).toContainText("stops every fix in the run");
  await expect(page.locator(".apply-needs")).toContainText("--apply needs git");
  await expect(page.locator("main")).not.toContainText("journal");
  await page.getByText("4 · Keep checking automatically", { exact: true }).click();
  await expect(page.locator("#watch-command")).toContainText("watch --dir /path/to/app --apply --interval 900");
  await expect(page.getByText("What leaves your machine", { exact: true })).toBeVisible();
  const privacy = page.locator("details").filter({ has: page.getByText("What leaves your machine", { exact: true }) });
  await privacy.locator("summary").press("Enter");
  await expect(privacy).toContainText("No source is uploaded to Ludion");

  const copy = page.getByRole("button", { name: "Copy scan command", exact: true });
  await expect(copy).toHaveCount(1);
  await copy.click();
  await expect(copy).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("node packages/cli/dist/cli.js scan --dir /path/to/app");

  const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
  expect(hrefs.filter((href) => href.includes("/lessons/") || href.includes("/bench"))).toEqual([]);
});
