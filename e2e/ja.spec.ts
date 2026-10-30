// The Japanese pages (/ja/, /ja/start/): language, hreflang both ways, the language link, no redirect by language,
// and the same content and controls as the English pages. axe, reflow, canonical and the water check cover them
// through allPages() and water.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import { en as enStrings } from "../apps/site/src/strings/en.ts";
import { ja as jaStrings } from "../apps/site/src/strings/ja.ts";

const PAIRS = [
  { en: "/", ja: "/ja/" },
  { en: "/start/", ja: "/ja/start/" },
];
const SECTIONS = ["guard", "verify", "isolate", "receipt"] as const;

// Every English string that the Japanese file translates (names, ids and code-like labels are the same in both).
const leaves = (value: unknown): string[] =>
  typeof value === "string" ? [value] : Object.values(value as object).flatMap(leaves);
const jaLeaves = new Set(leaves(jaStrings));
const ENGLISH = [...new Set(leaves(enStrings).filter((text) => !jaLeaves.has(text) && /[A-Za-z]/.test(text)))];

/**
 * No English label or sentence is left on the page (code, ids and product names aside), visible or not yet replaced by
 * a script. Each English string of en.ts that ja.ts translates is looked for, so a string hard-coded in a component
 * shows up here. Besides the body's text, it reads the title, the description and og: text, the labels and texts kept
 * in attributes, and what each template holds.
 */
async function noEnglishLeft(page: Page) {
  const text = await page.evaluate(() => [
    document.title,
    document.body.textContent ?? "",
    ...[...document.querySelectorAll("meta[name=description], meta[property^='og:']")].map((el) => el.getAttribute("content") ?? ""),
    ...[...document.querySelectorAll("*")].flatMap((el) =>
      ["aria-label", "title", "alt", "data-copied", "data-selected"].map((name) => el.getAttribute(name) ?? "")),
    ...[...document.querySelectorAll("template")].map((el) => el.content.textContent ?? ""),
  ].join("\n"));
  expect(ENGLISH.length).toBeGreaterThan(100);
  expect(ENGLISH.filter((english) => text.includes(english))).toEqual([]);
}

async function alternates(page: Page) {
  return page.locator('link[rel="alternate"][hreflang]').evaluateAll((links) => links.map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")]));
}

for (const { en, ja } of PAIRS) {
  test(`${en} and ${ja} name each other, and each links to the other`, async ({ page }) => {
    const expected = [
      ["en", `https://ludion.ai${en}`],
      ["ja", `https://ludion.ai${ja}`],
      ["x-default", `https://ludion.ai${en}`],
    ];
    await page.goto(en);
    expect(await page.locator("html").getAttribute("lang")).toBe("en");
    expect(await alternates(page)).toEqual(expected);
    const toJa = page.locator(".site-header nav a[hreflang=ja]");
    await expect(toJa).toHaveText("日本語");
    await expect(toJa).toHaveAttribute("href", ja);
    await expect(toJa).toHaveAttribute("lang", "ja");

    await page.goto(ja);
    expect(await page.locator("html").getAttribute("lang")).toBe("ja");
    expect(await alternates(page)).toEqual(expected);
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe(`https://ludion.ai${ja}`);
    const toEn = page.locator(".site-header nav a[hreflang=en]");
    await expect(toEn).toHaveText("English");
    await expect(toEn).toHaveAttribute("href", en);
    await expect(toEn).toHaveAttribute("lang", "en");
    await toEn.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(en);
    expect(await page.locator("html").getAttribute("lang")).toBe("en");
  });

  test(`${en} is not redirected by the browser's language`, async ({ request }) => {
    const response = await request.get(en, { maxRedirects: 0, headers: { "Accept-Language": "ja,en;q=0.5" } });
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('<html lang="en"');
  });

  test(`${ja} is not redirected by the browser's language`, async ({ request }) => {
    const response = await request.get(ja, { maxRedirects: 0, headers: { "Accept-Language": "en" } });
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('<html lang="ja"');
  });
}

test("the 404 page has no language link or hreflang", async ({ page }) => {
  await page.goto("/no-such-page/");
  expect(await alternates(page)).toEqual([]);
  await expect(page.locator(".site-header nav a[hreflang]")).toHaveCount(0);
});

test("the Japanese home page carries the same workflow and limits, with its links kept in Japanese", async ({ page }) => {
  await page.goto("/ja/");
  await expect(page.locator("h1")).toContainText("開発を続けながら、");
  await expect(page.locator("h1")).toContainText("スタックも前へ進めましょう。");
  await expect(page.locator(".introduction")).toContainText("PHP、JavaScript、TypeScript、Java");
  await expect(page.getByRole("link", { name: "プレビューを試す" }).first()).toHaveAttribute("href", "/ja/start/");
  await expect(page.getByRole("link", { name: "しくみ", exact: true })).toHaveAttribute("href", "/ja/#guard");
  await expect(page.getByRole("link", { name: "流れを見る", exact: true })).toHaveAttribute("href", "#guard");
  for (const id of SECTIONS) await expect(page.locator(`#${id}`)).toBeVisible();
  await expect(page.locator("#guard")).toContainText("流れを図にした例です。");
  await expect(page.locator("#isolate")).toContainText("完了した更新ではありません");
  await expect(page.locator("#receipt")).toContainText("実行の結果ではありません");
  await expect(page.locator("#receipt")).toContainText("本番へのデプロイ");
  await expect(page.locator("[data-guard-state]")).toHaveText([/update/, /no-match/, /unknown/, /unsupported/]);
  await expect(page.locator("#coverage")).toContainText("対応している範囲を確かめてください。");
  await expect(page.locator("#coverage tbody tr")).toHaveCount(4);
  await noEnglishLeft(page);
  const hrefs = await page.locator("a[href^='/']").evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
  expect(hrefs.filter((href) => !href.startsWith("/ja/") && href !== "/")).toEqual([]);
  expect(hrefs.filter((href) => href === "/")).toEqual(["/"]);
});

test("the Japanese home page keeps its content without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/ja/");
  await expect(page.locator("h1")).toContainText("開発を続けながら、");
  await expect(page.locator("[data-guard-state]")).toHaveCount(4);
  await expect(page.locator("[data-trace-panel=receipt]")).toContainText("ソースのハッシュ、テスト結果");
  await expect(page.locator("#receipt")).toContainText("本番へのデプロイ");
  await expect(page.locator(".fallback-route")).toContainText("依存関係のファイル");
  await noEnglishLeft(page);
  await context.close();
});

test("the Japanese home page works by keyboard", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/ja/");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveText("本文へ移動");
  // Header: home, two links, the language link.
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveText("English");
  const first = page.locator("[data-trace-step=guard]");
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-trace-step=program]")).toBeFocused();
  await expect(page.locator("[data-trace-step=program]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-trace-panel=program]")).toBeVisible();
  await expect(page.locator("[data-trace-step=program]")).toHaveText("解決");
  const run = page.locator("[data-delivery-target=run]");
  await run.focus();
  await page.keyboard.press("Enter");
  await expect(run).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-delivery-status]")).toContainText("2 · 検証");
});

test("the Japanese home page's motion follows reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/ja/");
  const stage = page.locator("[data-context-stage]");
  await expect(stage).toHaveClass(/active/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(stage).not.toHaveClass(/active/);
});

test("the Japanese setup page keeps the commands, copies them, and opens each step by keyboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/ja/start/");
  await expect(page.locator("h1")).toHaveText("ひとつの流れで、スタックのより広い範囲を。");
  await noEnglishLeft(page);
  await expect(page.locator("#scan-command")).toHaveText("node packages/cli/dist/cli.js scan --dir /path/to/app");
  await expect(page.locator("#source-command")).toContainText("npm run build -w ludion-ai");
  await expect(page.locator(".where")).toContainText("npm 0.1.4 には、これらのコマンドは入っていません");
  await expect(page.locator(".coverage")).toContainText("本番を自動でデプロイし直すことはありません");
  const apply = page.locator("details").filter({ has: page.getByText("3 · 検証してから適用する", { exact: true }) });
  await apply.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#patch-command")).toBeVisible();
  await expect(page.locator("#patch-command")).not.toContainText("--apply");
  await expect(page.locator("#apply-command")).toContainText("--apply");
  await expect(page.locator(".apply-branches")).toContainText("手元のファイルも今のブランチも変えません");
  await expect(page.locator(".apply-branches code")).toHaveText("ludion/<ecosystem>/<package>-<version>");
  await expect(page.locator(".apply-branches")).toContainText("その実行のすべての修正を止めます");
  await expect(page.locator(".apply-needs")).toContainText("--apply には");
  await page.getByText("4 · 自動で確かめ続ける", { exact: true }).click();
  await expect(page.locator("#watch-command")).toContainText("watch --dir /path/to/app --apply --interval 900");
  const privacy = page.locator("details").filter({ has: page.getByText("手元から外へ出るもの", { exact: true }) });
  await privacy.locator("summary").press("Enter");
  await expect(privacy).toContainText("ソースを Ludion にアップロードすることはなく");

  const copy = page.getByRole("button", { name: "scan コマンドをコピー", exact: true });
  await expect(copy).toHaveText("コピー");
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect(copy).toHaveText("コピーしました");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("node packages/cli/dist/cli.js scan --dir /path/to/app");
});

test("Japanese text breaks by phrase and by the strict rules, in the device's font", async ({ page }) => {
  for (const path of ["/ja/", "/ja/start/"]) {
    await page.goto(path);
    const style = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      return { wordBreak: s.wordBreak, lineBreak: s.lineBreak, font: s.fontFamily, code: getComputedStyle(document.querySelector("code")!).fontFamily };
    });
    expect(style.code, path).toMatch(/^"?JetBrains Mono Variable"?,.*Hiragino Sans.*Yu Gothic.*Noto Sans JP/);
    expect(style.wordBreak, path).toBe("auto-phrase");
    expect(style.lineBreak, path).toBe("strict");
    expect(style.font, path).toContain("Hiragino Sans");
    expect(style.font, path).toContain("Yu Gothic");
    expect(style.font, path).toContain("Noto Sans JP");
    // No web font beyond the site's own two families.
    const fonts = await page.evaluate(() => [...document.fonts].map((f) => f.family.replaceAll('"', "")));
    expect([...new Set(fonts)].sort(), path).toEqual(["JetBrains Mono Variable", "Schibsted Grotesk Variable"]);
  }
});

test.describe("on a phone", () => {
  test.use({ isMobile: true, hasTouch: true });

  test("the Japanese pages keep reachable controls at 320 px, also at 200 percent text", async ({ page }) => {
    for (const path of ["/ja/", "/ja/start/"]) {
      for (const big of [false, true]) {
        await page.setViewportSize({ width: 320, height: 740 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        if (big) {
          await page.evaluate(() => {
            const sizes = [...document.querySelectorAll("*")].map((el) => ({ el, size: parseFloat(getComputedStyle(el).fontSize) }));
            for (const { el, size } of sizes) if (el instanceof HTMLElement || el instanceof SVGElement) el.style.fontSize = `${size * 2}px`;
          });
        }
        const sizes = await page.evaluate(() => ({ layout: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
        expect(sizes.layout, `${path} ${big ? "200%" : ""}`).toBe(320);
        expect(sizes.content, `${path} ${big ? "200%" : ""}`).toBeLessThanOrEqual(321);
        const targets = await page.locator(".site-header nav a").evaluateAll((items) => items.map((el) => {
          const r = el.getBoundingClientRect();
          return { name: el.textContent?.trim(), left: r.left, right: r.right, width: r.width, height: r.height };
        }));
        expect(targets).toHaveLength(3);
        for (const t of targets) {
          expect(t.width, `${t.name}: touch width`).toBeGreaterThanOrEqual(24);
          expect(t.height, `${t.name}: touch height`).toBeGreaterThanOrEqual(24);
          expect(t.left, `${t.name}: left edge`).toBeGreaterThanOrEqual(-0.5);
          expect(t.right, `${t.name}: right edge`).toBeLessThanOrEqual(320.5);
        }
      }
    }
    await page.goto("/ja/");
    await expect(page.locator("[data-delivery-target=install]")).toContainText("解決");
    await expect(page.locator("[data-delivery-target=run]")).toContainText("検証");
    await expect(page.locator("[data-delivery-target=apply]")).toContainText("適用");
  });
});
