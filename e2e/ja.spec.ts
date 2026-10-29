// The Japanese pages (/ja/ and /ja/start/): their language, the links between the two languages, and their words.
// a11y.spec.ts, home-mobile.spec.ts, home.spec.ts's motion checks and water.spec.ts cover them with the English pages.
import { expect, test } from "@playwright/test";

const SITE = "https://ludion.ai";
const PAIRS = [
  ["/", "/ja/"],
  ["/start/", "/ja/start/"],
] as const;
const EXAMPLES: Record<string, string> = { guard: "判定のイメージ図です。", verify: "判定のイメージ図です。", isolate: "流れのイメージ図です。判定ではありません。", receipt: "コメントの構成を示したもので、判定ではありません。" };
const SECTIONS = ["guard", "verify", "isolate", "receipt"] as const;
const REMOVED = /--apply|\b(scan|patch|PHP|Composer|Maven|Docker)\b|スキャン|パッチ/;

test("each page has its language, names both versions with English as the default, and links to the other", async ({ page }) => {
  for (const [en, ja] of PAIRS) {
    for (const { path, lang, other, otherLang, label } of [
      { path: en, lang: "en", other: ja, otherLang: "ja", label: "日本語" },
      { path: ja, lang: "ja", other: en, otherLang: "en", label: "English" },
    ]) {
      await page.goto(path);
      await expect(page.locator("html"), path).toHaveAttribute("lang", lang);
      const alternates = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((els) => els.map((el) => [el.getAttribute("hreflang"), el.getAttribute("href")]));
      expect(alternates, path).toEqual([["en", `${SITE}${en}`], ["ja", `${SITE}${ja}`], ["x-default", `${SITE}${en}`]]);
      expect(await page.locator('link[rel="canonical"]').getAttribute("href"), path).toBe(`${SITE}${path}`);
      const link = page.locator(".site-header nav a[hreflang]");
      await expect(link, path).toHaveCount(1);
      await expect(link, path).toHaveText(label);
      await expect(link, path).toHaveAttribute("href", other);
      await expect(link, path).toHaveAttribute("hreflang", otherLang);
      await expect(link, path).toHaveAttribute("lang", otherLang);
    }
  }
});

test("the language link opens the same page in the other language, and back", async ({ page }) => {
  await page.goto("/start/");
  await page.getByRole("link", { name: "日本語", exact: true }).click();
  await expect(page).toHaveURL(/\/ja\/start\/$/);
  await expect(page.locator("h1")).toHaveText("npm の依存更新 PR を判定する");
  await page.getByRole("link", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/start\/$/);
  await expect(page.locator("h1")).toHaveText("Judge your npm dependency PRs.");
});

test("a Japanese browser still gets the English pages: nothing redirects by language", async ({ browser }) => {
  const context = await browser.newContext({ locale: "ja-JP", extraHTTPHeaders: { "Accept-Language": "ja-JP,ja;q=0.9" } });
  const page = await context.newPage();
  for (const path of ["/", "/start/"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    expect(response?.request().redirectedFrom(), path).toBeNull();
    expect(new URL(page.url()).pathname, path).toBe(path);
    await expect(page.locator("html"), path).toHaveAttribute("lang", "en");
  }
  await context.close();
});

test("the Japanese home page describes the judge and says it never applies or merges", async ({ page }) => {
  await page.goto("/ja/");
  await expect(page).toHaveTitle("Ludion — npm の依存更新を判定するツール");
  const heading = page.locator("h1");
  await expect(heading).toContainText("npm の依存更新 PR を、");
  await expect(heading).toContainText("1つのコメントで判定します。");
  await expect(page.locator(".introduction")).toContainText("コメントするだけで、マージはしません。");
  await expect(page.locator(".site-header a.home")).toHaveAttribute("href", "/ja/");
  await expect(page.locator(".site-header").getByRole("link", { name: "仕組み", exact: true })).toHaveAttribute("href", "/ja/#guard");
  await expect(page.locator(".site-header").getByRole("link", { name: "プレビューを試す", exact: true })).toHaveAttribute("href", "/ja/start/");
  await expect(page.locator(".introduction + .invitation").getByRole("link", { name: "プレビューを試す" })).toHaveAttribute("href", "/ja/start/");
  await expect(page.getByRole("link", { name: "判定の種類を見る", exact: true })).toHaveAttribute("href", "#guard");
  for (const id of SECTIONS) {
    const section = page.locator(`#${id}`);
    await expect(section).toBeVisible();
    await expect(section).toContainText(EXAMPLES[id]!);
  }
  await expect(page.locator("#guard h2")).toHaveText("判定は4種類。「適用」はありません。");
  await expect(page.locator("[data-guard-state]")).toHaveText([/stop/, /wait/, /ready_except_build/, /undecidable/]);
  await expect(page.locator("[data-guard-state=ready_except_build]")).toContainText("更新を適用してよいという判定ではありません");
  await expect(page.locator("#receipt")).toContainText("関門3、ビルドとテスト");
  await expect(page.locator("#receipt .not-checked li")).toHaveCount(7);
  await expect(page.locator("#receipt .coverage")).toContainText("プレビュー版で、まだリリースしていません");
  await expect(page.locator("#isolate .command a")).toHaveAttribute("href", "/ja/start/");
  await expect(page.locator("#coverage h2")).toHaveText("判定役が読むもの");
  await expect(page.locator("#coverage")).toContainText("npm だけです");
  await expect(page.locator(".closing-scene a")).toHaveAttribute("href", "/ja/start/");
  await expect(page.locator("main")).not.toContainText(REMOVED);
  const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
  expect(hrefs.filter((href) => href.includes("/lessons/") || href.includes("/bench"))).toEqual([]);
});

test("the Japanese verdicts, checks and comment stay in the page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/ja/");
  await expect(page.locator("h1")).toContainText("npm の依存更新 PR を、");
  for (const id of SECTIONS) await expect(page.locator(`#${id}`)).toContainText(EXAMPLES[id]!);
  await expect(page.locator("[data-guard-state]")).toHaveCount(4);
  await expect(page.locator("#receipt")).toContainText("確かめていないこと");
  await expect(page.locator("[data-trace-panel=lockfile]")).toContainText("sha512");
  await context.close();
});

test("the Japanese setup page shows the same workflows and commands, says nothing is released, and copies them", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const blocks = ["#judge-workflow", "#comment-workflow", "#source-command", "#judge-command"];
  await page.goto("/start/");
  const english = await Promise.all(blocks.map((id) => page.locator(id).textContent()));
  await page.goto("/ja/start/");
  await expect(page).toHaveTitle("npm の依存更新 PR を判定する | Ludion");
  expect(await Promise.all(blocks.map((id) => page.locator(id).textContent()))).toEqual(english);
  await expect(page.locator(".where")).toContainText("まだリリースしていません");
  await expect(page.locator(".where")).toContainText("40文字の完全な SHA");
  await expect(page.locator(".coverage").first()).toContainText("判定役が更新を適用してよいと言うことはありません");
  await expect(page.locator(".privacy-summary")).toContainText("安全という意味ではなく");
  await expect(page.locator("main")).not.toContainText(REMOVED);

  const privacy = page.locator("details").filter({ has: page.getByText("外に送るもの", { exact: true }) });
  await privacy.locator("summary").press("Enter");
  await expect(privacy).toContainText("ソースは送らず");

  const copy = page.getByRole("button", { name: "判定のコマンドをコピー", exact: true });
  await expect(copy).toHaveText("コピー");
  await copy.click();
  await expect(copy).toHaveText("コピーしました");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(english[3]);
  const workflow = page.getByRole("button", { name: "判定のワークフローをコピー", exact: true });
  await workflow.click();
  await expect(workflow).toHaveText("コピーしました");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(english[0]);
});

test("Japanese text uses the device's Japanese fonts, breaks lines by phrase, and loads no outside font", async ({ page }) => {
  const fonts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") fonts.push(request.url());
  });
  for (const path of ["/ja/", "/ja/start/"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    const style = await page.evaluate(() => {
      const html = getComputedStyle(document.documentElement);
      const p = getComputedStyle(document.querySelector("main p")!);
      return { family: getComputedStyle(document.body).fontFamily, wordBreak: html.wordBreak, lineBreak: html.lineBreak, pBreak: p.wordBreak, pLine: p.lineBreak };
    });
    for (const font of ["Hiragino Sans", "Yu Gothic", "Noto Sans JP"]) expect(style.family, path).toContain(font);
    expect(style, path).toMatchObject({ wordBreak: "auto-phrase", lineBreak: "strict", pBreak: "auto-phrase", pLine: "strict" });
  }
  expect(fonts.length).toBeGreaterThan(0);
  for (const url of fonts) expect(new URL(url).host, url).toBe(new URL(page.url()).host);
  await page.goto("/");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).wordBreak)).toBe("normal");
});

test("by keyboard: skip link, header and language link first, then the checks move with the arrow keys", async ({ page }) => {
  await page.goto("/ja/");
  const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  await page.keyboard.press("Tab");
  expect(await focused()).toBe("本文へ移動");
  await page.keyboard.press("Tab");
  await expect(page.locator(".site-header a.home")).toBeFocused();
  for (const name of ["仕組み", "プレビューを試す", "English"]) {
    await page.keyboard.press("Tab");
    expect(await focused()).toBe(name);
  }
  const paths = page.locator("[data-trace-step=paths]");
  await paths.focus();
  await page.keyboard.press("ArrowRight");
  const source = page.locator("[data-trace-step=source]");
  await expect(source).toBeFocused();
  await expect(source).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#trace-source")).toBeVisible();
  await expect(page.locator("#trace-source")).toContainText("来歴証明（provenance）");
  await page.keyboard.press("End");
  await expect(page.locator("[data-trace-step=lockfile]")).toHaveAttribute("aria-pressed", "true");
});
