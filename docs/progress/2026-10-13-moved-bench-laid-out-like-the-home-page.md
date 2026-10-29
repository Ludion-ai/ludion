### 2026-10-13: `/bench` laid out like the home page

- **Built** (`apps/site` only): a big statement and three linked figures up top, numbered sections with short captions, one models × lessons figure (cut by subject on phones), unmeasured models as empty tracks in Done 3, and the lesson list grouped by subject with marks for silent and agent drafts in place of repeated words. Decisions: `docs/decisions.md`, "The bench page, laid out like the home page".
- **Checked**: `npm test` (434), `npm run test:e2e` (8, axe in light and dark), the sample build; screenshots at 1280 and 390, light and dark (`docs/site/2026-10-13-bench-editorial/`), and at 1024 and 700; hover, click, and filters tried. The review found the page scrolling sideways between 761 and about 1010 px (the full figure can't shrink below 8 px squares), which no screenshot width had caught: the figure now picks its layout from its own width, and an e2e test checks nine widths from 360 to 1280.

