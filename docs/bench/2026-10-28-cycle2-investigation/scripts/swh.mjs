// Public read-only probe: does Software Heritage archive npm origins, and does it hold @ensdomains/buffer 0.1.1?
const urls = [
  "https://archive.softwareheritage.org/api/1/origin/https://www.npmjs.com/package/@ensdomains/buffer/get/",
  "https://archive.softwareheritage.org/api/1/origin/https://www.npmjs.com/package/@ensdomains/buffer/visits/?per_page=5",
  "https://archive.softwareheritage.org/api/1/origin/search/ensdomains%2Fbuffer/?limit=5",
  "https://web.archive.org/cdx/search/cdx?url=www.npmjs.com/package/@ensdomains/buffer&output=json&limit=20",
];
for (const u of urls) {
  try {
    const r = await fetch(u, { headers: { "user-agent": "ludion-research (read-only)" } });
    const t = await r.text();
    console.log(r.status, u, "\n", t.slice(0, 700), "\n");
  } catch (e) { console.log("ERR", u, String(e)); }
}
