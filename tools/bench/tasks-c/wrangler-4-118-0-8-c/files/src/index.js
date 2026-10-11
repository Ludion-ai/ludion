export default {
  async fetch(request) {
    if (request.method !== "POST") return new Response("Send a POST with {\"email\": ...}", { status: 405 });
    const { email } = await request.json();
    console.log("signup request", { email, ua: request.headers.get("user-agent") });
    return Response.json({ ok: true });
  },
};
