import type { APIRequestContext } from "@playwright/test";

/** The bench pages: each model's page and share card, and one run log per model (from bench.json). */
async function benchPages(request: APIRequestContext): Promise<string[]> {
  const bench = (await (await request.get("/bench.json")).json()) as { done3: { rows: { model: string }[] } | null; without_tools: { rows: { model: string }[] } | null };
  const ids = [...new Set([...(bench.done3?.rows ?? []), ...(bench.without_tools?.rows ?? [])].map((r) => r.model))];
  const pages = ids.flatMap((id) => [`/bench/${id}/`, `/bench/og/${id}/`]);
  for (const id of ids) {
    // The first run log the model's page links to, if it has any.
    const html = await (await request.get(`/bench/${id}/`)).text();
    const run = new RegExp(`href="(/bench/${id}/[^"/]+/)"`).exec(html)?.[1];
    if (run) pages.push(run);
  }
  return pages;
}

/** Every page the site builds, found from index.json so the list grows with the lessons. */
export async function allPages(request: APIRequestContext): Promise<string[]> {
  const index = (await (await request.get("/index.json")).json()) as {
    lessons: { id: string; subject: string }[];
    teachers: Record<string, { login: string }>;
  };
  return [
    "/",
    "/lessons/",
    "/start/",
    "/bench/",
    "/bench/method/",
    ...(await benchPages(request)),
    ...[...new Set(index.lessons.map((l) => l.subject))].map((s) => `/${s}/`),
    ...index.lessons.map((l) => `/lessons/${l.id}/`),
    ...Object.values(index.teachers).map((t) => `/@${t.login.toLowerCase()}`),
    "/no-such-page/",
  ];
}
