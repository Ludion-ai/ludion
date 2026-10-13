// /bench: the old /models address redirects to it, and each model page's share card is a 1200×630 PNG.
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

test("/models redirects to /bench", async ({ request }) => {
  for (const path of ["/models", "/models/"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(301);
    expect(new URL(res.headers()["location"]!, "http://x").pathname, path).toBe("/bench/");
  }
});

test("each model page names its share card, and the card is a 1200×630 PNG", async ({ page, request }) => {
  const bench = (await (await request.get("/bench.json")).json()) as { done3: { rows: { model: string }[] } | null };
  const ids = [...new Set((bench.done3?.rows ?? []).map((r) => r.model))];
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    await page.goto(`/bench/${id}/`);
    const image = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(image).toBe(`https://ludion.ai/bench/og/${id}.png`);
    expect(await page.locator('meta[name="twitter:card"]').getAttribute("content")).toBe("summary_large_image");
    const res = await request.get(`/bench/og/${id}.png`);
    expect(res.status()).toBe(200);
    const png = PNG.sync.read(await res.body());
    expect([png.width, png.height]).toEqual([1200, 630]);
  }
});

test("/bench's lesson list: each subject's heading spans its rows, with the model names over their marks", async ({ page }) => {
  // A subject group is an li too; when the rows' grid reached it, the heading sat in the version column and the
  // model names ran over the first claim.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/bench/");
  const groups = await page.evaluate(() =>
    [...document.querySelectorAll("li.group[data-group]")].map((g) => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right };
      };
      const part = (selector: string) => box(g.querySelector(selector)!);
      return { group: box(g), head: part(".ghead"), who: part(".ghead .who"), marks: part(".marks") };
    }),
  );
  expect(groups.length).toBeGreaterThan(0);
  for (const g of groups) {
    expect(g.head.left).toBeCloseTo(g.group.left, 0);
    expect(g.head.right).toBeCloseTo(g.group.right, 0);
    expect(g.who.left).toBeCloseTo(g.marks.left, 0);
    expect(g.who.right).toBeCloseTo(g.marks.right, 0);
  }
});

test("the main pages never scroll sideways, at any width their layouts switch around", async ({ page, request }) => {
  // About thirty page loads, each now drawing water (WebGL in software on CI): more than the default 30 s.
  test.setTimeout(240_000);
  // The newest lesson, and the newest one verified across versions (its page draws the versions).
  const index = (await (await request.get("/index.json")).json()) as { lessons: { id: string; subject:string; verified_by: string }[]; teachers: Record<string,{login:string}> };
  const lessons = [index.lessons[0], index.lessons.find((l) => l.verified_by === "differential")].filter((l) => l != null);
  expect(lessons.length).toBeGreaterThan(0);
  const teacher = Object.values(index.teachers)[0]!;
  for (const path of ["/", "/start/", "/bench/", "/lessons/", `/${lessons[0]!.subject}/`, `/@${teacher.login.toLowerCase()}`, ...lessons.map((l) => `/lessons/${l.id}/`)]) {
    for (const width of [320, 360, 390, 700, 761, 800, 900, 1010, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(scroll, `${path} at ${width}px`).toBeLessThanOrEqual(client);
    }
  }
});

test("bench lesson groups use the full available width on a phone", async ({page}) => {
  await page.setViewportSize({width:320,height:900});
  await page.goto("/bench/");
  const widths = await page.locator(".groups > .group > .list").evaluateAll(lists => lists.map(list => ({list:list.getBoundingClientRect().width,group:list.parentElement!.getBoundingClientRect().width})));
  expect(widths.length).toBeGreaterThan(0);
  for (const width of widths) expect(width.list).toBeGreaterThanOrEqual(width.group - 1);
});
