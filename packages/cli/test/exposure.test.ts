// LEXP (docs/bench/lexp/definitions.md): the end of exposure time is the merge of Ludion's PR, recorded on that PR
// (X1, X2), and the PR's found_at is the first run, of an unbroken row of the workflow's runs, whose check saw the fix
// (X4). GitHub's API and the artifact download are stand-ins; no test reaches the network.
import { describe, expect, it } from "vitest";
import { firstSeen, pullRequestBody, recordMerge, type CheckedArtifact, type CheckedFix } from "../src/security/deliver.ts";
import { seenAt, withRuns, zip, type StandInRun } from "./runs.ts";

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const nowhere = (async (input: string | URL | Request) => { throw new Error(`unexpected request ${String(input)}`); }) as typeof fetch;

const LODASH: CheckedFix = {
  package: "lodash", changes: [{ name: "lodash", from: "4.17.20", to: "4.17.21", advisories: ["GHSA-35jh-r3h4-6jhm", "CVE-2021-23337"] }],
  branch: "ludion/npm/lodash-4.17.21", commit: "a".repeat(40), subject: "ludion: lodash 4.17.20 -> 4.17.21 (npm)", message: "", tree: "", files: [{ path: "package-lock.json", after_hash: "b".repeat(64) }],
  fix_published_at: "2021-02-20T15:42:16.891Z", found_at: "2026-10-30T01:00:00.000Z", applied_at: "2026-10-30T01:05:00.000Z", verdict: "ready_except_build",
};
const ARTIFACT: CheckedArtifact = { id: "0f1e2d3c-4b5a-4968-8776-655443322110", ecosystem: "npm", base: "c".repeat(40), fixes: [LODASH], notApplied: {} };

describe("the merge of Ludion's PR is recorded on it (X1, X2)", () => {
  const BODY = pullRequestBody(ARTIFACT, LODASH);
  const MERGED_AT = "2026-10-31T09:00:00Z", MERGE = "d".repeat(40);
  const pr = (over: Record<string, unknown> = {}) => ({
    number: 5, state: "closed", merged: true, merged_at: MERGED_AT, merge_commit_sha: MERGE, body: BODY, user: { login: "github-actions[bot]" },
    head: { ref: LODASH.branch, repo: { full_name: "o/r" } }, base: { ref: "main" }, ...over,
  });
  function github(p: Record<string, unknown>, comments: { user: { login: string }; body: string }[] = [], options: { failPull?: boolean } = {}) {
    const posted: string[] = [], calls: string[] = [];
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(input)), method = init?.method ?? "GET";
      calls.push(`${method} ${u.pathname}${u.search}`);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer t0ken");
      if (u.pathname === "/repos/o/r") return reply(200, { default_branch: "main" });
      if (u.pathname === "/repos/o/r/pulls/5") return options.failPull ? reply(502, { message: "Bad Gateway" }) : reply(200, p);
      if (u.pathname === "/repos/o/r/issues/5/comments" && method === "GET") return reply(200, u.searchParams.get("page") === "1" ? comments : []);
      if (u.pathname === "/repos/o/r/issues/5/comments" && method === "POST") {
        const body = String(JSON.parse(String(init?.body)).body);
        posted.push(body);
        comments.push({ user: { login: "github-actions[bot]" }, body });
        return reply(201, { id: 1 });
      }
      return reply(404, { message: "Not Found" });
    }) as typeof fetch;
    return { fetchFn, posted, calls };
  }
  const merge = (gh: ReturnType<typeof github>) => recordMerge({ repo: "o/r", pr: 5, api: "https://api.github.invalid", token: "t0ken", fetchFn: gh.fetchFn });

  it("posts one comment whose first line is the record as JSON and whose table gives the exposure hours; a second call posts nothing", async () => {
    const gh = github(pr());
    const first = await merge(gh);
    expect(first.outcome).toBe("recorded");
    expect(gh.posted).toHaveLength(1);
    const [head, ...rest] = gh.posted[0]!.split("\n");
    const json = /^<!-- ludion-merged (\{.*\}) -->$/.exec(head!);
    expect(json).not.toBeNull();
    expect(JSON.parse(json![1]!)).toEqual({
      schema: 1, pr: 5, branch: LODASH.branch, merged_at: "2026-10-31T09:00:00.000Z", merge_commit_sha: MERGE,
      fix_published_at: LODASH.fix_published_at, found_at: LODASH.found_at, applied_at: LODASH.applied_at,
    });
    const text = rest.join("\n");
    const exposure = ((Date.parse(MERGED_AT) - Date.parse(LODASH.fix_published_at!)) / H).toFixed(1);
    for (const part of ["`2026-10-31T09:00:00.000Z`", "`dddddddddddd`", `\`${exposure}\` hours`, `\`${((Date.parse(MERGED_AT) - Date.parse(LODASH.found_at)) / H).toFixed(1)}\` hours`, "not deployed", "checked for form only"]) expect(text).toContain(part);
    expect(text).not.toMatch(/@\w/);
    const second = await merge(gh);
    expect(second.outcome).toBe("already_recorded");
    expect(gh.posted).toHaveLength(1);
  });
  it("records nothing for a PR that is not a merged Ludion fix into the default branch", async () => {
    for (const [over, why] of [
      [{ merged: false, merged_at: null }, "not merged"],
      [{ user: { login: "someone" } }, "not opened by github-actions[bot]"],
      [{ head: { ref: LODASH.branch, repo: { full_name: "fork/r" } } }, "another repository"],
      [{ head: { ref: "feature/x", repo: { full_name: "o/r" } } }, "not a Ludion branch"],
      [{ base: { ref: "release" } }, "not the default branch"],
      [{ body: BODY.replace("<!-- ludion-fix -->\n", "") }, "Ludion's marker"],
      [{ merged_at: "yesterday" }, "merged_at"],
      [{ merge_commit_sha: "nope" }, "merge commit"],
    ] as const) {
      const gh = github(pr(over));
      const r = await merge(gh);
      expect(r.outcome, why).toBe("not_recorded");
      expect(r.reason, why).toContain(why);
      expect(gh.posted, why).toHaveLength(0);
    }
  });
  it("a failing API call throws; another bot's or a person's marker comment does not count as the record", async () => {
    await expect(merge(github(pr(), [], { failPull: true }))).rejects.toThrow("HTTP 502");
    const gh = github(pr(), [{ user: { login: "mallory" }, body: "<!-- ludion-merged {} -->" }]);
    expect((await merge(gh)).outcome).toBe("recorded");
  });
  it("an image move with no newer security release is recorded as not counted; a body time later than the merge is not computed", async () => {
    const move: CheckedFix = { ...LODASH, package: "php", changes: [{ name: "php", from: "8.4.26", to: "8.4.28", advisories: [] }], branch: "ludion/php/8.4.28", fix_published_at: null, verdict: null, waited_until: "2026-10-29T00:00:00.000Z" };
    const body = pullRequestBody({ ...ARTIFACT, ecosystem: "php", fixes: [move] }, move);
    const gh = github(pr({ body, head: { ref: move.branch, repo: { full_name: "o/r" } } }));
    expect((await merge(gh)).outcome).toBe("recorded");
    expect(gh.posted[0]).toContain("\"fix_published_at\":null");
    expect(gh.posted[0]).toContain("not counted in exposure time");
    const late: CheckedFix = { ...LODASH, found_at: "2026-11-30T00:00:00.000Z" };
    const gh2 = github(pr({ body: pullRequestBody(ARTIFACT, late) }));
    expect((await merge(gh2)).outcome).toBe("recorded");
    expect(gh2.posted[0]).toMatch(/Found → merged \| not computed: /);
  });
});

describe("found_at is the first run of the row whose check saw the fix (X4, X5)", () => {
  const T0 = Date.parse("2026-10-30T00:00:00Z");
  const started = (k: number) => iso(T0 + k * 6 * H);
  const SAW = [{ key: "npm:lodash", advisories: ["GHSA-35jh-r3h4-6jhm"] }];
  const OTHER = [{ key: "npm:minimist", advisories: ["GHSA-xvch-5gv4-984h"] }];
  /** Runs 1..n, 6 hours apart; run n is this run. */
  const row = (records: (unknown[] | null | Partial<StandInRun>)[]): StandInRun[] => records.map((r, i) => {
    const id = i + 1, base = { id, started: started(id) };
    if (r === null) return base;
    if (Array.isArray(r)) return { ...base, record: seenAt(base.started, r) };
    return { ...base, ...r };
  });
  const walk = (runs: StandInRun[], fixes = [LODASH], over: { runId?: number; asked?: string[]; blobAuth?: string[]; refuse?: number; limit?: number } = {}) =>
    firstSeen({ repo: "o/r", runId: over.runId ?? runs.length, defaultBranch: "main", ecosystem: "npm", api: "https://api.github.invalid", token: "t0ken", fetchFn: withRuns(nowhere, runs, over), limit: over.limit }, fixes);

  it("the earliest run of the row that lists the fix; a run whose valid record does not list it ends the row", async () => {
    const r = await walk(row([SAW, OTHER, SAW, SAW, SAW]));
    expect(r.seen.get(LODASH.branch)).toEqual({ at: iso(Date.parse(started(3)) + 5 * 60_000), run: 3, ended: true });
    expect(r.read).toBe(4);
  });
  it("a run with no record, an expired one, a failed list or an invalid one is passed over, and the row goes on", async () => {
    const bad = (k: number, over: Record<string, unknown>) => ({ record: { ...seenAt(started(k), OTHER), ...over } });
    const runs = row([
      SAW,
      null,
      { record: seenAt(started(3), OTHER), expired: true },
      { failArtifacts: true },
      bad(5, { ecosystem: "composer" }),
      bad(6, { checked_at: iso(Date.parse(started(6)) - H) }),
      bad(7, { checked_at: iso(Date.parse(started(7)) + 11 * 60_000) }),
      bad(8, { keys: [{ key: "npm:minimist", advisories: ["GHSA-<b>"] }] }),
      bad(9, { schema: 2 }),
      { bytes: Buffer.from("not a zip") },
      { bytes: zip("seen.json", "x".repeat(2 * 1024 * 1024)) },
      { bytes: zip("other.json", JSON.stringify(seenAt(started(12), OTHER))) },
      // A small, valid entry in a zip over 1 MiB, and an entry whose size the central directory misstates.
      { bytes: zip("seen.json", JSON.stringify(seenAt(started(13), OTHER)), { pad: 1024 * 1024 }) },
      { bytes: zip("seen.json", JSON.stringify(seenAt(started(14), OTHER)), { lie: 1 }) },
      SAW,
    ]);
    const r = await walk(runs);
    expect(r.seen.get(LODASH.branch)).toEqual({ at: iso(Date.parse(started(1)) + 5 * 60_000), run: 1, ended: false });
    expect(r.read).toBe(2);
  });
  it("reads a deflated zip with a data descriptor, as upload-artifact writes it, and asks the redirect without the token", async () => {
    const blobAuth: string[] = [], asked: string[] = [];
    const runs = row([OTHER, { bytes: zip("seen.json", JSON.stringify(seenAt(started(2), SAW)), { deflate: true, descriptor: true }) }, SAW]);
    const r = await walk(runs, [LODASH], { blobAuth, asked });
    expect(r.seen.get(LODASH.branch)).toMatchObject({ run: 2, ended: true });
    expect(blobAuth).toEqual(["", "", ""]);
    expect(asked.filter(a => a.startsWith("GET https://blob.invalid/"))).toHaveLength(3);
  });
  it("another advisory of the same package, or another package, does not match; no record lists it: null", async () => {
    // An earlier run saw lodash with another advisory only: it does not list this fix, so it ends the row.
    const other = await walk(row([[{ key: "npm:lodash", advisories: ["GHSA-29mw-wpgm-hmr9"] }], SAW]));
    expect(other.seen.get(LODASH.branch)).toEqual({ at: iso(Date.parse(started(2)) + 5 * 60_000), run: 2, ended: true });
    expect((await walk(row([SAW, OTHER]))).seen.get(LODASH.branch)).toBeNull();
  });
  it("keeps the limit of runs, and does not read runs of another event or branch, or later than this run", async () => {
    const many = row(Array.from({ length: 130 }, () => SAW));
    const capped = await walk(many);
    expect(capped.read).toBe(100);
    expect(capped.seen.get(LODASH.branch)).toEqual({ at: iso(Date.parse(started(31)) + 5 * 60_000), run: 31, ended: false });
    // A limit below one page of 100 runs.
    const ten = await walk(many, [LODASH], { limit: 10 });
    expect(ten.read).toBe(10);
    expect(ten.seen.get(LODASH.branch)).toMatchObject({ run: 121, ended: false });
    const asked: string[] = [];
    const runs: StandInRun[] = [
      { id: 1, started: started(1), record: seenAt(started(1), SAW) },
      { id: 2, started: started(2), record: seenAt(started(2), OTHER), event: "push" },
      { id: 3, started: started(3), record: seenAt(started(3), OTHER), branch: "feature" },
      { id: 4, started: started(4), record: seenAt(started(4), SAW) },
      { id: 5, started: started(5), record: seenAt(started(5), OTHER) },
    ];
    const r = await walk(runs, [LODASH], { runId: 4, asked });
    expect(r.seen.get(LODASH.branch)).toMatchObject({ run: 1, ended: false });
    expect(asked.some(a => /runs\/(2|3|5)\/artifacts/.test(a))).toBe(false);
  });
  it("images: a security release the fix lists, or, for a move with none, the same candidate", async () => {
    const php: CheckedFix = { ...LODASH, package: "php", changes: [{ name: "php", from: "8.4.26", to: "8.4.28", advisories: [] }], branch: "ludion/php/8.4.28", releases: ["8.4.27", "8.4.28"] };
    const newest: CheckedFix = { ...php, branch: "ludion/php/8.4.29", changes: [{ name: "php", from: "8.4.28", to: "8.4.29", advisories: [] }], releases: [], waited_until: "2026-10-29T00:00:00.000Z" };
    const images = (keys: unknown[][]) => keys.map((k, i) => ({ id: i + 1, started: started(i + 1), record: seenAt(started(i + 1), k, "php") })) as StandInRun[];
    const image = (runs: StandInRun[], fix: CheckedFix) => firstSeen({ repo: "o/r", runId: runs.length, defaultBranch: "main", ecosystem: "php", api: "https://api.github.invalid", token: "t0ken", fetchFn: withRuns(nowhere, runs) }, [fix]);
    const security = await image(images([
      [{ key: "php", releases: ["8.4.25"], candidate: "8.4.25" }],
      [{ key: "php", releases: ["8.4.27"], candidate: "8.4.27" }],
      [{ key: "php", releases: ["8.4.27", "8.4.28"], candidate: "8.4.28" }],
    ]), php);
    expect(security.seen.get(php.branch)).toMatchObject({ run: 2, ended: true });
    const move = await image(images([
      [{ key: "php", releases: [], candidate: "8.4.25" }],
      [{ key: "php", releases: [], candidate: "8.4.29" }],
      [{ key: "php", releases: [], candidate: "8.4.29" }],
    ]), newest);
    expect(move.seen.get(newest.branch)).toMatchObject({ run: 2, ended: true });
    // A record of an npm key does not list an image fix.
    const npm = await image([{ id: 1, started: started(1), record: seenAt(started(1), SAW, "php") }], php);
    expect(npm.seen.get(php.branch)).toBeNull();
  });
  it("throws when the runs cannot be read (no actions: read), so the caller keeps the receipt's found_at", async () => {
    await expect(walk(row([SAW, SAW]), [LODASH], { refuse: 403 })).rejects.toThrow("HTTP 403");
  });
});

describe("the PR body's Found row (X4, X5)", () => {
  it("names the run that saw the fix first, or says why it is this run's lookup", () => {
    const seen = pullRequestBody(ARTIFACT, { ...LODASH, found_at: "2026-10-29T00:05:00.000Z", seen: { at: "2026-10-29T00:05:00.000Z", run: 41, read: 7, ended: true } });
    expect(seen).toMatch(/\| Found \| `2026-10-29T00:05:00\.000Z` \(the check of run `41`, the first of an unbroken row of this workflow's runs whose record lists this fix; `7` records read\) \|/);
    const open = pullRequestBody(ARTIFACT, { ...LODASH, seen: { at: LODASH.found_at, run: 41, read: 100, ended: false } });
    expect(open).toContain("an earlier run may have seen it first");
    const none = pullRequestBody(ARTIFACT, { ...LODASH, seen: { at: LODASH.found_at, run: null, read: 3, ended: true } });
    expect(none).toContain("| Found | `2026-10-30T01:00:00.000Z` (this run's lookup: no record of this workflow's runs lists this fix; `3` records read) |");
    const failed = pullRequestBody(ARTIFACT, { ...LODASH, seen: { at: LODASH.found_at, run: null, read: 0, ended: false, why: "GitHub did not list this workflow's runs (HTTP 403) | `x`" } });
    expect(failed).toContain("(this run's lookup: earlier runs' records were not read: GitHub did not list this workflow's runs (HTTP 403)");
    expect(failed).not.toContain("| `x`");
  });
});
