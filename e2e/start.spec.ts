import { expect, test } from "@playwright/test";

const LOCAL = "node packages/cli/dist/cli.js judge --before /path/to/app-main --after /path/to/app-pr --files package.json,package-lock.json";

test("setup shows the two workflows pinned to a release commit, says nothing is released, and copies the judge command", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/start/");
  await expect(page.locator(".where")).toContainText("Not released yet");
  await expect(page.locator(".where")).toContainText("full 40-character SHA");
  await expect(page.locator("#judge-workflow")).toContainText("uses: Ludion-ai/ludion@<release commit SHA>");
  await expect(page.locator("#judge-workflow")).toContainText("contents: read");
  await expect(page.locator("#judge-workflow")).toContainText("mode: judge");
  await expect(page.locator("#judge-workflow")).toContainText("group: ludion-judge-${{ github.event.pull_request.number }}");
  await expect(page.locator("#comment-workflow")).toContainText("uses: Ludion-ai/ludion@<the same release commit SHA>");
  await expect(page.locator("#comment-workflow")).toContainText("pull-requests: write");
  await expect(page.locator("#comment-workflow")).toContainText("mode: comment");
  await expect(page.locator(".coverage")).toContainText("never says an update can be applied");
  await expect(page.locator("#source-command")).toContainText("npm run build -w ludion-ai");
  await expect(page.locator("#judge-command")).toHaveText(LOCAL);
  await expect(page.locator("main")).not.toContainText(/--apply|\b(scan|patch|PHP|Composer|Maven|Docker)\b/);

  await expect(page.getByText("What leaves your machine", { exact: true })).toBeVisible();
  const privacy = page.locator("details").filter({ has: page.getByText("What leaves your machine", { exact: true }) });
  await privacy.locator("summary").press("Enter");
  await expect(privacy).toContainText("No source is sent");

  const copy = page.getByRole("button", { name: "Copy judge command", exact: true });
  await expect(copy).toHaveCount(1);
  await copy.click();
  await expect(copy).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LOCAL);

  const workflow = page.getByRole("button", { name: "Copy the judging workflow", exact: true });
  await workflow.click();
  await expect(workflow).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("name: ludion-judge\non:\n  pull_request:\n    paths: [package-lock.json]\n");

  const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
  expect(hrefs.filter((href) => href.includes("/lessons/") || href.includes("/bench"))).toEqual([]);
});
