### 2026-10-12: Being found (sitemap, llms.txt, robots.txt)

- **Checked on production before this**: `/llms.txt` and `/sitemap.xml` answered 404, and `/robots.txt` held only Cloudflare's managed content-signal comments (no directives, no sitemap). Lesson pages already had a title (the claim), a meta description, and a canonical link.
- **`/sitemap.xml`** (built with the site): home, `/start/`, `/models/` (`/bench/`, `/bench/method/` and each `/bench/<model>/` since 2026-10-13), `/lessons/`, every subject page, every lesson page (active, replaced, and tombstones, with `lastmod` from `verified_at` or the retraction date), and every teacher page at its canonical `/@login`.
- **`/llms.txt`** (llmstxt.org): what Ludion is, that lessons are data, the partial-coverage sentence, where the data is (`/start/`, `/index.json`, the shards, `/models/`, `/bench/` since 2026-10-13), and every active lesson by subject: a link named by the lesson's id, then the same claim `index.json` serves, untouched, its teacher, "drafted by an agent" where it applies, and how it was verified. The claim is never link text: a symbol like `workflows[].concurrency.limit` has brackets, and stripping them would change the fact.
- **`/robots.txt`** in `apps/site/public`: allow all, and name the sitemap. Cloudflare's managed robots.txt, if on for the zone, adds its own lines to it.
- `llms.txt`, `sitemap.xml`, and `robots.txt` joined `RESERVED_SUBJECTS`: a subject with one of those names would build a folder where the file must be.
- Not done: structured data (JSON-LD) on lesson pages. Nothing measured says it matters yet.

