// A stand-in for GitHub's workflow runs and their ludion-seen artifacts (docs/bench/lexp/definitions.md, section 3), in
// front of another stand-in fetch. Nothing is fetched. An artifact's zip is served, as GitHub does, by a redirect to
// another address, which must be asked without the token.
import { crc32, deflateRawSync } from "node:zlib";

/** A zip with one entry, as upload-artifact writes it: deflated or stored, sizes in a data descriptor when asked. */
export function zip(name: string, data: string | Buffer, options: { deflate?: boolean; descriptor?: boolean } = {}): Buffer {
  const raw = Buffer.from(data), body = options.deflate ? deflateRawSync(raw) : raw, crc = crc32(raw) >>> 0, method = options.deflate ? 8 : 0;
  const file = Buffer.from(name), flags = options.descriptor ? 8 : 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
  local.writeUInt32LE(options.descriptor ? 0 : crc, 14); local.writeUInt32LE(options.descriptor ? 0 : body.length, 18); local.writeUInt32LE(options.descriptor ? 0 : raw.length, 22);
  local.writeUInt16LE(file.length, 26);
  const descriptor = Buffer.alloc(options.descriptor ? 16 : 0);
  if (options.descriptor) { descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc, 4); descriptor.writeUInt32LE(body.length, 8); descriptor.writeUInt32LE(raw.length, 12); }
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(file.length, 28);
  central.writeUInt32LE(0, 42);
  const start = local.length + file.length + body.length + descriptor.length, size = central.length + file.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(start, 16);
  return Buffer.concat([local, file, body, descriptor, central, file, end]);
}

export type StandInRun = {
  id: number; started: string; event?: string; branch?: string;
  /** The seen.json the run's check job uploaded; absent: no artifact. */
  record?: unknown;
  /** The artifact's bytes instead of a zip of `record`. */
  bytes?: Buffer;
  expired?: boolean;
  /** The artifact's created_at; 10 minutes after `started` by default. */
  created?: string;
  /** The run's artifact list answers 500. */
  failArtifacts?: boolean;
};

export const SEEN_COMMIT = "e".repeat(40);
/** A valid record: checked 5 minutes into the run, with these keys. */
export const seenAt = (started: string, keys: unknown[], ecosystem = "npm") =>
  ({ schema: 1, kind: "ludion-seen", checked_at: new Date(Date.parse(started) + 5 * 60_000).toISOString(), commit: SEEN_COMMIT, ecosystem, keys });

export function withRuns(fetchFn: typeof fetch, runs: StandInRun[], options: { repo?: string; refuse?: number; asked?: string[]; blobAuth?: string[] } = {}): typeof fetch {
  const repo = options.repo ?? "o/r", reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const artifactId = (run: StandInRun) => 1000 + run.id;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    if (url.hostname === "blob.invalid") {
      options.asked?.push(`${method} ${url.href}`);
      options.blobAuth?.push(new Headers(init?.headers).get("authorization") ?? "");
      const run = runs.find(r => artifactId(r) === Number(url.pathname.split("/").pop()));
      if (!run) return new Response("missing", { status: 404 });
      return new Response(new Uint8Array(run.bytes ?? zip("seen.json", JSON.stringify(run.record))), { status: 200 });
    }
    const path = url.pathname, prefix = `/repos/${repo}/actions/`;
    if (!path.startsWith(prefix)) return fetchFn(input, init);
    options.asked?.push(`${method} ${path}${url.search}`);
    if (options.refuse) return reply(options.refuse, { message: "Resource not accessible by integration" });
    const rest = path.slice(prefix.length);
    let m: RegExpExecArray | null;
    if ((m = /^runs\/(\d+)$/.exec(rest))) {
      const run = runs.find(r => r.id === Number(m![1]));
      return run ? reply(200, { id: run.id, workflow_id: 9, run_started_at: run.started, event: run.event ?? "schedule", head_branch: run.branch ?? "main" }) : reply(404, { message: "Not Found" });
    }
    if (rest === "workflows/9/runs") {
      const page = Number(url.searchParams.get("page") ?? "1"), per = Number(url.searchParams.get("per_page") ?? "30"), branch = url.searchParams.get("branch");
      const all = runs.filter(r => !branch || (r.branch ?? "main") === branch).sort((a, b) => b.id - a.id);
      return reply(200, { total_count: all.length, workflow_runs: all.slice((page - 1) * per, page * per).map(r => ({ id: r.id, event: r.event ?? "schedule", head_branch: r.branch ?? "main", run_started_at: r.started })) });
    }
    if ((m = /^runs\/(\d+)\/artifacts$/.exec(rest))) {
      const run = runs.find(r => r.id === Number(m![1]));
      if (!run) return reply(404, { message: "Not Found" });
      if (run.failArtifacts) return reply(500, { message: "Server Error" });
      const has = run.record !== undefined || run.bytes !== undefined;
      const created = run.created ?? new Date(Date.parse(run.started) + 10 * 60_000).toISOString();
      const list = has && url.searchParams.get("name") === "ludion-seen" ? [{ id: artifactId(run), name: "ludion-seen", expired: !!run.expired, created_at: created, size_in_bytes: 100 }] : [];
      return reply(200, { total_count: list.length, artifacts: list });
    }
    if ((m = /^artifacts\/(\d+)\/zip$/.exec(rest))) return new Response(null, { status: 302, headers: { location: `https://blob.invalid/a/${m[1]}?sig=x` } });
    return reply(404, { message: "Not Found" });
  }) as typeof fetch;
}
