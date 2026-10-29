### 2026-10-12: Analytics

- **Google Analytics 4** on the site (measurement ID `G-91CJFHRK88`), at the owner's request. Nothing in the CLI or the MCP server: the "No telemetry" on `/start` is about the CLI and stays true. The footer of every page says "This site uses Google Analytics."
- **`apps/site/public/ga.js`**, loaded with `defer` from the base layout, so every page has it and the CSP needs no `'unsafe-inline'`. It sets the Consent Mode defaults, then adds `gtag.js`. It does nothing unless the host is `ludion.ai`: local builds, CI, and the end-to-end tests send no hits. So the home page's 60 KB JavaScript budget still measures only the site's own scripts; `gtag.js` is Google's and loads only in production.
- **Consent Mode**: the EEA (the EU plus Iceland, Liechtenstein, and Norway), the UK, and Switzerland default to `analytics_storage: denied`, with no banner, so GA4 stores nothing there and gets only cookieless pings. Elsewhere `analytics_storage` is granted. The site shows no ads, so `ad_storage`, `ad_user_data`, and `ad_personalization` are denied everywhere.
- **CSP**: only the origins Google lists for GA4 without Ads features (developers.google.com/tag-platform/security/guides/csp): `script-src https://www.googletagmanager.com`; `img-src https://www.googletagmanager.com https://*.google-analytics.com`; `connect-src https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com`. Nothing else was loosened.
- This replaces v0's "no analytics beyond Cloudflare Web Analytics", which v2's CLAUDE.md doesn't carry.

