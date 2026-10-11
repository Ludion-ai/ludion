export default {
  async fetch(request) {
    return new Response("pg-proxy prototype: HTTP is only for health checks\n");
  },
};
