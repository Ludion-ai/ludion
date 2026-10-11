import { WorkflowEntrypoint } from "cloudflare:workers";

// Pushes one order to the partner's fulfilment API.
export class SyncOrders extends WorkflowEntrypoint {
  async run(event, step) {
    const order = event.payload;
    await step.do("push order to partner", { retries: { limit: 5, delay: "10 seconds", backoff: "exponential" } }, async () => {
      const res = await fetch("https://partner.example.com/v1/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(order),
      });
      if (!res.ok) throw new Error(`partner API answered ${res.status}`);
    });
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("POST an order", { status: 405 });
    const order = await request.json();
    const instance = await env.SYNC_ORDERS.create({ params: order });
    return Response.json({ id: instance.id });
  },
};
