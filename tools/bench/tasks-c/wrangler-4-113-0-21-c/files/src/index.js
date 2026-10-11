const UPSTREAM = "https://api.example.com";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const upstream = await fetch(UPSTREAM + url.pathname);
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "text/plain" },
    });
  },
};
