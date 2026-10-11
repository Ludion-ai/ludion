export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cached = await env.CACHE.get(url.pathname);
    if (cached) return new Response(cached);
    const body = `Hello from ${env.ENVIRONMENT}`;
    await env.CACHE.put(url.pathname, body, { expirationTtl: 60 });
    return new Response(body);
  },
};
