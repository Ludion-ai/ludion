### 2026-10-13: `/lessons` and the lesson pages redrawn

- **Built** (`apps/site` and an e2e test): claims set in parts, a two-column list row everywhere lessons are listed, `/lessons` with subject tiles, search, filters, and subject groups, and lesson pages with the models' verdicts and a differential test drawn as its versions. Decisions: `docs/decisions.md`, "The lesson pages, set like the bench".
- **Checked**: `npm test` (450, with `claim-parts.test.ts`: every claim on the site comes back word for word), `npm run test:e2e` (9: axe in light and dark on every page; no sideways scroll on `/bench/`, `/lessons/`, and a lesson page at nine widths from 360 to 1280), the sample build. Fixed on the way: `/lessons` was 416 px wide on a 390 px phone (a long claim), and the large seal was 6 px too wide at 360. Screenshots: `docs/site/2026-10-13-lessons/`.

