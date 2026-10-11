// Web APIs only: the last Node.js dependency (node:crypto for hashing) was replaced by Web Crypto.
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const etag = await sha256Hex(url.pathname);
    return new Response(`Hello from ${url.pathname}`, { headers: { etag: `"${etag}"` } });
  },
};
