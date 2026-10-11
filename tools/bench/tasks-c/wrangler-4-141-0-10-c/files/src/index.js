import { DurableObject } from "cloudflare:workers";

// Message format v2: { id, author, body, sentAt } (v1 stored "user", "text", "ts").
// Old and new code cannot run side by side: v1 code cannot read v2 rows.
export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, author TEXT, body TEXT, sent_at INTEGER)",
    );
  }

  async post(author, body) {
    const message = { id: crypto.randomUUID(), author, body, sentAt: Date.now() };
    this.ctx.storage.sql.exec("INSERT INTO messages VALUES (?, ?, ?, ?)", message.id, author, body, message.sentAt);
    return message;
  }

  async history() {
    return this.ctx.storage.sql
      .exec("SELECT id, author, body, sent_at AS sentAt FROM messages ORDER BY sent_at")
      .toArray();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const room = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(url.pathname));
    if (request.method === "POST") {
      const { author, body } = await request.json();
      return Response.json(await room.post(author, body));
    }
    return Response.json(await room.history());
  },
};
