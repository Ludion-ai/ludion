import { expect, test } from "@playwright/test";

test("sync setup shows the commands, copies the sync command, and does not link to lesson pages", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/start/");
  await expect(page.locator("#sync-command")).toHaveText("npx ludion-ai sync");
  await expect(page.locator("#plugin-command")).toContainText("/plugin marketplace add ");
  await expect(page.locator("#plugin-command")).toContainText("/plugin install ludion@ludion");
  await expect(page.locator("#mcp-command")).toContainText("claude mcp add --transport http ludion ");
  await expect(page.locator("#mcp-command")).toContainText("/mcp");
  await expect(page.locator("#teach-command")).toHaveText("npx ludion-ai teach draft.json");
  await expect(page.locator("#public-command")).toHaveText("npx ludion-ai teach draft.json --public");
  await expect(page.getByText("What leaves your machine", { exact: true })).toBeVisible();
  const privacy = page.locator("details").filter({ has: page.getByText("What leaves your machine", { exact: true }) });
  await privacy.locator("summary").press("Enter");
  await expect(privacy).toContainText("Cloudflare");

  const copy = page.getByRole("button", { name: "Copy: npx ludion-ai sync", exact: true });
  await expect(copy).toHaveCount(1);
  await copy.click();
  await expect(copy).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("npx ludion-ai sync");

  const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
  expect(hrefs.filter((href) => href.includes("/lessons/") || href.includes("/bench"))).toEqual([]);
});
