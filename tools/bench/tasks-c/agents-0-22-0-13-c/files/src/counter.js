import { DurableObject } from 'cloudflare:workers';

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

// A plain Durable Object (not an Agent). Other Workers call hit() and count() over RPC.
export class Counter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS hits (at INTEGER NOT NULL)');
  }

  async hit() {
    this.ctx.storage.sql.exec('INSERT INTO hits (at) VALUES (?)', Date.now());
    return this.count();
  }

  async count() {
    return this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM hits').one().n;
  }

  // Deletes hits older than 30 days.
  async compact() {
    this.ctx.storage.sql.exec('DELETE FROM hits WHERE at < ?', Date.now() - THIRTY_DAYS_MS);
  }
}
