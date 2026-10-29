import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { judge, urgencyOf } from "../src/security/judge.ts";
import { EPSS_LIMITS, EPSS_LIST, epssScores, gatherFacts } from "../src/security/npm-facts.ts";

const DAY = "https://epss.empiricalsecurity.com/epss_scores-2026-10-29.csv.gz";
const LIST = "#model_version:v2026.06.15,score_date:2026-10-29T12:03:14Z\ncve,epss,percentile\nCVE-1999-0001,0.04753,0.9186\nCVE-2026-12345,0.27183,0.98048\nCVE-2026-9999,0.00249,0.16284\n";
const INTEGRITY = "sha512-" + "A".repeat(86) + "==";

type Seen = { url: string; body: string; headers: string; redirect: RequestRedirect | undefined };
/** A FIRST that redirects the fixed URL to the day's file, as it did on 2026-10-29; `day` answers the second request. */
function first(day: () => Response | Promise<Response> = () => new Response(gzipSync(LIST)), location = "epss_scores-2026-10-29.csv.gz") {
  const seen: Seen[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, body: init?.body === undefined ? "" : String(init.body), headers: JSON.stringify([...new Headers(init?.headers)]), redirect: init?.redirect });
    if (url === EPSS_LIST) return new Response(null, { status: 302, headers: { location } });
    if (url === DAY) return day();
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchFn, seen };
}

describe("EPSS, from FIRST's whole daily list", () => {
  it("looks the CVE ids up in the list it downloaded, and sends none of them", async () => {
    const { fetchFn, seen } = first();
    const scores = await epssScores(["CVE-2026-12345", "CVE-2026-10001"], fetchFn);
    expect([...scores]).toEqual([["CVE-2026-12345", 0.27183]]);
    expect(seen.map(s => s.url)).toEqual([EPSS_LIST, DAY]);
    expect(seen.every(s => s.redirect === "manual" && s.body === "")).toBe(true);
    for (const s of seen) expect(s.url + s.body + s.headers).not.toMatch(/CVE/i);
  });
  it("reads a list with Windows line ends and no comment line, and a list served without a redirect", async () => {
    const crlf = LIST.split("\n").slice(1).join("\r\n");
    expect([...(await epssScores(["CVE-1999-0001"], first(() => new Response(gzipSync(crlf))).fetchFn))]).toEqual([["CVE-1999-0001", 0.04753]]);
    const direct = (async () => new Response(gzipSync(LIST))) as unknown as typeof fetch;
    expect([...(await epssScores(["CVE-2026-9999"], direct))]).toEqual([["CVE-2026-9999", 0.00249]]);
  });
  it("sends no CVE id anywhere while gathering the facts of a fix, and still rates it by EPSS", async () => {
    const seen: Seen[] = [];
    const time: Record<string, string> = { created: "2020-01-01T00:00:00Z", "1.0.0": "2026-09-01T00:00:00Z", "1.0.1": "2026-10-01T00:00:00Z" };
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, body: init?.body === undefined ? "" : String(init.body), headers: JSON.stringify([...new Headers(init?.headers)]), redirect: init?.redirect });
      if (url === "https://api.osv.dev/v1/querybatch") {
        const queries = JSON.parse(String(init?.body)).queries as { version: string }[];
        return json({ results: queries.map(q => ({ vulns: q.version === "1.0.0" ? [{ id: "GHSA-aaaa-bbbb-cccc" }] : [] })) });
      }
      if (url === "https://api.osv.dev/v1/vulns/GHSA-aaaa-bbbb-cccc") return json({ id: "GHSA-aaaa-bbbb-cccc", aliases: ["CVE-2026-12345"], database_specific: { severity: "MODERATE" } });
      if (url.includes("known_exploited_vulnerabilities")) return json({ vulnerabilities: [] });
      if (url === EPSS_LIST) return new Response(null, { status: 302, headers: { location: "epss_scores-2026-10-29.csv.gz" } });
      if (url === DAY) return new Response(gzipSync(LIST));
      if (url === "https://registry.npmjs.org/lib") return json({ name: "lib", time, versions: Object.fromEntries(["1.0.0", "1.0.1"].map(v => [v, { name: "lib", version: v, _npmUser: { name: "bob" }, dist: { integrity: INTEGRITY } }])) });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const change = { path: "node_modules/lib", name: "lib", from: "1.0.0", to: "1.0.1", dev: false, resolved: "https://registry.npmjs.org/lib/-/lib-1.0.1.tgz", integrity: INTEGRITY, replaced: null };
    const { fixes } = await gatherFacts([change], fetchFn);
    expect(fixes).toMatchObject([{ id: "GHSA-aaaa-bbbb-cccc", aliases: ["CVE-2026-12345"], epss: 0.27183 }]);
    // The rule is unchanged: an EPSS of 0.1 or more makes a moderate fix high.
    expect(urgencyOf(fixes, [change])).toBe("high");
    expect(seen.some(s => s.url === DAY)).toBe(true);
    for (const s of seen) expect(s.url + s.body + s.headers).not.toMatch(/CVE/i);
  });

  const stops: [string, () => ReturnType<typeof first>, RegExp][] = [
    ["FIRST answers an error", () => first(() => new Response("busy", { status: 503 })), /HTTP 503/],
    ["FIRST answers with part of the list", () => first(() => new Response(gzipSync(LIST), { status: 206 })), /HTTP 206/],
    ["the fixed URL answers an error", () => ({ fetchFn: (async () => new Response("gone", { status: 404 })) as unknown as typeof fetch, seen: [] }), /HTTP 404/],
    ["the redirect goes to another host", () => first(undefined, "https://example.com/epss_scores-2026-10-29.csv.gz"), /redirected/],
    ["the redirect goes to plain http", () => first(undefined, "http://epss.empiricalsecurity.com/epss_scores-2026-10-29.csv.gz"), /redirected/],
    ["the redirect goes to another path on the host", () => first(undefined, "/other.csv.gz"), /redirected/],
    ["the redirect carries a query", () => first(undefined, "epss_scores-2026-10-29.csv.gz?x=1"), /redirected/],
    ["the redirect carries a fragment", () => first(undefined, "epss_scores-2026-10-29.csv.gz#x"), /redirected/],
    ["the redirect carries a user name", () => first(undefined, "https://u@epss.empiricalsecurity.com/epss_scores-2026-10-29.csv.gz"), /redirected/],
    ["the redirect carries a password", () => first(undefined, "https://:p@epss.empiricalsecurity.com/epss_scores-2026-10-29.csv.gz"), /redirected/],
    ["the redirect goes to another port", () => first(undefined, "https://epss.empiricalsecurity.com:8443/epss_scores-2026-10-29.csv.gz"), /redirected/],
    ["the redirect has no location", () => ({ fetchFn: (async () => new Response(null, { status: 302 })) as unknown as typeof fetch, seen: [] }), /redirected/],
    ["the day's file redirects again", () => first(() => new Response(null, { status: 302, headers: { location: "epss_scores-2026-10-28.csv.gz" } })), /HTTP 302/],
    ["the body is not gzip", () => first(() => new Response(LIST)), /could not be expanded/],
    ["the gzip is cut short", () => first(() => new Response(gzipSync(LIST).subarray(0, 40))), /could not be expanded/],
    ["the header is missing", () => first(() => new Response(gzipSync("CVE-1999-0001,0.04753,0.9186\n"))), /header/],
    ["the list is only a header", () => first(() => new Response(gzipSync("cve,epss,percentile\n"))), /no scores/],
    ["a score is not a number", () => first(() => new Response(gzipSync(LIST + "CVE-2026-10001,high,0.5\n"))), /line 6/],
    ["a score is empty", () => first(() => new Response(gzipSync(LIST + "CVE-2026-10001,,0.5\n"))), /line 6/],
    ["a score is negative", () => first(() => new Response(gzipSync(LIST + "CVE-2026-10001,-0.5,0.5\n"))), /line 6/],
    ["a score is above 1", () => first(() => new Response(gzipSync(LIST + "CVE-2026-10001,1.5,0.5\n"))), /line 6/],
    ["a line has a fourth field", () => first(() => new Response(gzipSync(LIST + "CVE-2026-10001,0.1,0.5,x\n"))), /line 6/],
    ["a line has no percentile", () => first(() => new Response(gzipSync(LIST + "CVE-2026-10001,0.1\n"))), /line 6/],
    ["a line is not a CVE", () => first(() => new Response(gzipSync(LIST + "GHSA-aaaa-bbbb-cccc,0.1,0.5\n"))), /line 6/],
    ["a CVE is listed twice", () => first(() => new Response(gzipSync(LIST + "CVE-2026-12345,0.01,0.5\n"))), /line 6/],
    ["a blank line is inside the list", () => first(() => new Response(gzipSync(LIST + "\nCVE-2026-10001,0.1,0.5\n"))), /line 6/],
  ];
  for (const [what, make, message] of stops) it(`throws, so the judgement is undecidable, when ${what}`, async () => {
    await expect(epssScores(["CVE-2026-12345"], make().fetchFn)).rejects.toThrow(message);
  });

  it("throws when the compressed list is larger than its limit", async () => {
    const { fetchFn } = first(() => new Response(new Uint8Array(4096)));
    await expect(epssScores(["CVE-2026-12345"], fetchFn, { ...EPSS_LIMITS, compressed: 1024 })).rejects.toThrow(/exceeds 1024 bytes/);
  });
  it("throws when the list expands past its limit (a gzip bomb)", async () => {
    const bomb = gzipSync(Buffer.alloc(8 * 1024 * 1024, "0"));
    expect(bomb.length).toBeLessThan(EPSS_LIMITS.compressed);
    const { fetchFn } = first(() => new Response(bomb));
    await expect(epssScores(["CVE-2026-12345"], fetchFn, { ...EPSS_LIMITS, expanded: 1024 * 1024 })).rejects.toThrow(/could not be expanded within 1048576 bytes/);
  });
  it("throws when FIRST does not answer in time", async () => {
    const fetchFn = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    })) as typeof fetch;
    await expect(epssScores(["CVE-2026-12345"], fetchFn, { ...EPSS_LIMITS, ms: 50 })).rejects.toThrow(/timed out|abort/i);
  });
  it("throws when the list stops arriving part way", async () => {
    const stalled = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(gzipSync(LIST).subarray(0, 20)); } }));
    const { fetchFn } = first(stalled);
    await expect(epssScores(["CVE-2026-12345"], fetchFn, { ...EPSS_LIMITS, ms: 50 })).rejects.toThrow(/timed out|abort/i);
  });
  it("makes gatherFacts throw, never a fix without EPSS, when the list fails", async () => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://api.osv.dev/v1/querybatch") return json({ results: (JSON.parse(String(init?.body)).queries as { version: string }[]).map(q => ({ vulns: q.version === "1.0.0" ? [{ id: "GHSA-aaaa-bbbb-cccc" }] : [] })) });
      if (url === "https://api.osv.dev/v1/vulns/GHSA-aaaa-bbbb-cccc") return json({ id: "GHSA-aaaa-bbbb-cccc", aliases: ["CVE-2026-12345"] });
      if (url.includes("known_exploited_vulnerabilities")) return json({ vulnerabilities: [] });
      if (url === EPSS_LIST) return new Response("busy", { status: 503 });
      if (url === "https://registry.npmjs.org/lib") return json({ name: "lib", time: { created: "2020-01-01T00:00:00Z", "1.0.0": "2026-09-01T00:00:00Z", "1.0.1": "2026-10-01T00:00:00Z" }, versions: Object.fromEntries(["1.0.0", "1.0.1"].map(v => [v, { name: "lib", version: v, _npmUser: { name: "bob" }, dist: { integrity: INTEGRITY } }])) });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const change = { path: "node_modules/lib", name: "lib", from: "1.0.0", to: "1.0.1", dev: false, resolved: "https://registry.npmjs.org/lib/-/lib-1.0.1.tgz", integrity: INTEGRITY, replaced: null };
    const error = await gatherFacts([change], fetchFn).then(() => null, (e: Error) => e);
    expect(error?.message).toMatch(/HTTP 503 for the EPSS list/);
    // judge-cli passes the message on as an error, which makes the judgement undecidable.
    expect(judge({ changes: [change], facts: new Map(), fixes: [], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z"), errors: [error!.message] }).verdict).toBe("undecidable");
  });
});
