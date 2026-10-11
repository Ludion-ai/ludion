// Serves a built site (apps/site/dist) on 127.0.0.1, so `ludion sync` can read the shards of a commit that isn't
// deployed yet (LUDION_SITE=http://127.0.0.1:<port>). Usage: node tools/bench/src/serve.ts <dist dir> [port]
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES: Record<string, string> = { ".html": "text/html", ".json": "application/json", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };

export function serve(dist: string, port = 0) {
  const root = resolve(dist);
  return createServer((req, res) => {
    let path = normalize(join(root, decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)));
    if (path !== root && !path.startsWith(root + sep)) return res.writeHead(403).end();
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
    if (!existsSync(path)) return res.writeHead(404).end("not found");
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }).end(readFileSync(path));
  }).listen(port, "127.0.0.1");
}

if (import.meta.main) {
  const [dist, port] = process.argv.slice(2);
  if (!dist) {
    console.error("Usage: node tools/bench/src/serve.ts <dist dir> [port]");
    process.exit(2);
  }
  const server = serve(dist, Number(port ?? 0));
  server.on("listening", () => {
    const addr = server.address();
    console.log(`Serving ${dist} at http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : port}`);
  });
}
