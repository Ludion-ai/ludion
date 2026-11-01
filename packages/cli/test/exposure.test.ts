// LEXP (docs/bench/lexp/definitions.md): the end of exposure time is the merge of Ludion's PR, recorded on that PR
// (X1, X2), and the PR's found_at is the first run, of an unbroken row of the workflow's runs, whose check saw the fix
// (X4). GitHub's API and the artifact download are stand-ins; no test reaches the network.
import { describe, expect, it, vi } from "vitest";
import { firstSeen, pullRequestBody, recordMerge, SEEN_BYTES, SEEN_WALK_MS, unzipEntry, type CheckedArtifact, type CheckedFix } from "../src/security/deliver.ts";
import { seenAt, withRuns, zip, type StandInRun } from "./runs.ts";

// Every options argument deliver.ts passes to inflateRawSync, which is otherwise the real one: the inflated limit cannot
// be seen in a result (the size check after it gives the same null), only in what inflation may allocate (R252b N11).
const inflateOptions = vi.hoisted(() => [] as unknown[]);
vi.mock("node:zlib", async importOriginal => {
  const zlib = await importOriginal<typeof import("node:zlib")>();
  return { ...zlib, inflateRawSync: (buffer: Buffer, options?: import("node:zlib").ZlibOptions) => { inflateOptions.push(options); return zlib.inflateRawSync(buffer, options); } };
});

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
  // GitHub's answers are dated 2 minutes after the merge, and the merged job reads the PR a minute after that.
  const ANSWERED = new Date(Date.parse(MERGED_AT) + 2 * 60_000).toUTCString(), RAN = Date.parse(MERGED_AT) + 3 * 60_000;
  function github(p: Record<string, unknown>, comments: { user: { login: string }; body: string }[] = [], options: { failPull?: boolean; date?: string | null } = {}) {
    const posted: string[] = [], calls: string[] = [];
    const date = options.date === undefined ? ANSWERED : options.date;
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(input)), method = init?.method ?? "GET";
      calls.push(`${method} ${u.pathname}${u.search}`);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer t0ken");
      if (u.pathname === "/repos/o/r") return reply(200, { default_branch: "main" });
      if (u.pathname === "/repos/o/r/pulls/5") {
        if (options.failPull) return reply(502, { message: "Bad Gateway" });
        return new Response(JSON.stringify(p), { status: 200, headers: { "content-type": "application/json", ...(date === null ? {} : { date }) } });
      }
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
  const merge = (gh: ReturnType<typeof github>, ran = RAN) => recordMerge({ repo: "o/r", pr: 5, api: "https://api.github.invalid", token: "t0ken", fetchFn: gh.fetchFn, now: () => ran });

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
      recorded_at: "2026-10-31T09:03:00.000Z", answer_date: "2026-10-31T09:02:00.000Z", merged_at_doubt: null,
    });
    const text = rest.join("\n");
    expect(text).toContain("| Recorded | `2026-10-31T09:03:00.000Z` (this job's clock), `0.1` hours after GitHub's merged_at; GitHub's answer was dated `2026-10-31T09:02:00.000Z` |");
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
      // The form of a time, but no date (R252 N3), and days or hours Date.parse rolls over to another date (R252b N9).
      [{ merged_at: "2026-13-45T00:00:00Z" }, "merged_at"],
      [{ merged_at: "2026-04-31T12:00:00Z" }, "merged_at"],
      [{ merged_at: "2026-10-31T24:00:00Z" }, "merged_at"],
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
  it("a body time that has the form of a time but is no date is recorded as unknown, and the merge is still recorded (R252 N3, R252b N9)", async () => {
    // A day past the month's end and the hour 24 are rolled over by Date.parse (2026-02-30 to 2026-03-02), so they are
    // read as no date, not as another one; a time with fewer than three digits of milliseconds is a date.
    for (const bad of ["2026-13-45T00:00:00Z", "2026-02-30T00:00:00Z", "2026-10-31T24:00:00Z"]) {
      const body = BODY.replaceAll(`\`${LODASH.found_at}\``, `\`${bad}\``);
      expect(body, bad).toContain(`| Found | \`${bad}\``);
      const gh = github(pr({ body }));
      const r = await merge(gh);
      expect(r.outcome, bad).toBe("recorded");
      expect(r.record, bad).toMatchObject({ merged_at: "2026-10-31T09:00:00.000Z", found_at: null, fix_published_at: LODASH.fix_published_at, applied_at: LODASH.applied_at });
      expect(gh.posted, bad).toHaveLength(1);
      expect(gh.posted[0], bad).toContain("| Found | unknown |");
      expect(gh.posted[0], bad).toContain("| Found → merged | unknown |");
    }
    const short = github(pr({ body: BODY.replaceAll(`\`${LODASH.found_at}\``, "`2026-10-30T01:00:00.5Z`") }));
    expect((await merge(short)).record).toMatchObject({ found_at: "2026-10-30T01:00:00.500Z" });
  });
  it("a merged_at later than the Date of GitHub's own answer, or than this job's clock, is recorded with its doubt, and no hours end at it (X7)", async () => {
    // GitHub's answer is dated 08:09, 51 minutes before the merge it gives.
    const ahead = github(pr(), [], { date: new Date(Date.parse(MERGED_AT) - 51 * 60_000).toUTCString() });
    const r = await merge(ahead);
    expect(r.outcome).toBe("recorded");
    expect(r.record).toMatchObject({ merged_at: "2026-10-31T09:00:00.000Z", answer_date: "2026-10-31T08:09:00.000Z", recorded_at: "2026-10-31T09:03:00.000Z", merged_at_doubt: "GitHub's merged_at is 51.0 minutes later than the Date of GitHub's answer that gives it" });
    expect(ahead.posted).toHaveLength(1);
    const text = ahead.posted[0]!;
    expect(text.split("\n")[0]).toContain("\"merged_at_doubt\":\"GitHub's merged_at is 51.0 minutes later");
    expect(text).toContain("| Exposure time (published → merged) | not computed: GitHub's merged_at is 51.0 minutes later than the Date of GitHub's answer that gives it |");
    expect(text).toContain("| Found → merged | not computed: GitHub's merged_at is 51.0 minutes later than the Date of GitHub's answer that gives it |");
    expect(text).toContain("GitHub's merged_at is not used as the end");
    // The hours that do not end at the merge are still computed.
    expect(text).toMatch(/\| Published → found \| `[\d.]+` hours \|/);
    // No Date header; this job's clock is an hour before the merge GitHub gives.
    const late = github(pr(), [], { date: null });
    expect((await merge(late, Date.parse(MERGED_AT) - H)).record).toMatchObject({ answer_date: null, recorded_at: "2026-10-31T08:00:00.000Z", merged_at_doubt: "GitHub's merged_at is 60.0 minutes later than this job's clock" });
    expect(late.posted[0]).toContain("| Exposure time (published → merged) | not computed: GitHub's merged_at is 60.0 minutes later than this job's clock |");
    // A Date header that is no date is not compared; the runner's clock still is.
    expect((await merge(github(pr(), [], { date: "yesterday" }))).record).toMatchObject({ answer_date: null, merged_at_doubt: null });
    // The Date header is in whole seconds: the same second is no doubt, one second later is.
    expect((await merge(github(pr(), [], { date: new Date(Date.parse(MERGED_AT)).toUTCString() }))).record?.merged_at_doubt).toBeNull();
    expect((await merge(github(pr(), [], { date: new Date(Date.parse(MERGED_AT) - 1000).toUTCString() }))).record?.merged_at_doubt).toBe("GitHub's merged_at is 1 second later than the Date of GitHub's answer that gives it");
    // The job's clock a second after the merge: no doubt.
    expect((await merge(github(pr()), Date.parse(MERGED_AT) + 1000)).record?.merged_at_doubt).toBeNull();
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
  // The PR job's clock: after every stand-in run's start, unless a test says otherwise (X7).
  const LATER = Date.parse("2027-06-01T00:00:00Z");
  const walk = (runs: StandInRun[], fixes = [LODASH], over: { runId?: number; asked?: string[]; blobAuth?: string[]; refuse?: number; limit?: number; now?: number; date?: string } = {}) =>
    firstSeen({ repo: "o/r", runId: over.runId ?? runs.length, defaultBranch: "main", ecosystem: "npm", api: "https://api.github.invalid", token: "t0ken", fetchFn: withRuns(nowhere, runs, over), limit: over.limit, now: () => over.now ?? LATER }, fixes);

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
      // A time outside its run stops the walk (X7, below); these two are not valid at all.
      bad(6, { checked_at: "not a time" }),
      bad(7, { kind: "ludion-other" }),
      bad(8, { keys: [{ key: "npm:minimist", advisories: ["GHSA-<b>"] }] }),
      bad(9, { schema: 2 }),
      { bytes: Buffer.from("not a zip") },
      { bytes: zip("seen.json", "x".repeat(2 * 1024 * 1024)) },
      { bytes: zip("other.json", JSON.stringify(seenAt(started(12), OTHER))) },
      // A small, valid entry in a zip over 1 MiB, and an entry whose size the central directory misstates.
      { bytes: zip("seen.json", JSON.stringify(seenAt(started(13), OTHER)), { pad: 1024 * 1024 }) },
      { bytes: zip("seen.json", JSON.stringify(seenAt(started(14), OTHER)), { lie: 1 }) },
      // A deflated zip far under 1 MiB whose valid record, padded with spaces, inflates past 1 MiB (R252 N1).
      { bytes: zip("seen.json", JSON.stringify(seenAt(started(15), OTHER)) + " ".repeat(1024 * 1024), { deflate: true }) },
      // A checked_at Date.parse rolls over (November 31st to December 1st) into its run's span is no date (R252b N9).
      { started: "2026-12-01T00:00:00.000Z", record: { ...seenAt("2026-12-01T00:00:00.000Z", OTHER), checked_at: "2026-11-31T00:05:00Z" } },
      SAW,
    ]);
    const r = await walk(runs);
    expect(r.seen.get(LODASH.branch)).toEqual({ at: iso(Date.parse(started(1)) + 5 * 60_000), run: 1, ended: false });
    expect(r.read).toBe(2);
    const padded = runs[14]!.bytes!;
    expect(padded.length).toBeLessThan(64 * 1024);
    expect(JSON.parse(String(unzipEntry(padded, "seen.json", 2 * 1024 * 1024))).kind).toBe("ludion-seen");
  });
  it("found_at is the earliest record time of the row, not the record of the lowest run id, when an older run was re-run later (R252 N4)", async () => {
    // Run 1 was re-run after runs 2 and 3: GitHub keeps its id and moves its start, so its record is the latest.
    const runs: StandInRun[] = [
      { id: 1, started: started(5), record: seenAt(started(5), SAW) },
      { id: 2, started: started(2), record: seenAt(started(2), SAW) },
      { id: 3, started: started(3), record: seenAt(started(3), SAW) },
    ];
    const r = await walk(runs);
    expect(r.seen.get(LODASH.branch)).toEqual({ at: iso(Date.parse(started(2)) + 5 * 60_000), run: 2, ended: false });
    expect(r.read).toBe(3);
  });
  it("stops the walk once it has taken longer than its limit, so the caller keeps the receipt's found_at (R252 N7)", async () => {
    expect(SEEN_WALK_MS).toBe(5 * 60_000);
    const runs = row(Array.from({ length: 130 }, () => SAW));
    // The PR job's clock starts after its own run's start (X7).
    let clock = Date.parse(started(130)) + H;
    const ticks: number[] = [];
    const now = () => { ticks.push(clock); return (clock += 40_000); };
    await expect(firstSeen({ repo: "o/r", runId: 130, defaultBranch: "main", ecosystem: "npm", api: "https://api.github.invalid", token: "t0ken", fetchFn: withRuns(nowhere, runs), now }, [LODASH])).rejects.toThrow("the walk took longer than 5 minutes");
    // It stopped within the first runs, not after reading all 100.
    expect(ticks.length).toBeLessThan(15);
  });
  it("the walk's limit holds while the runs are listed, before any record is read (R252b N10)", async () => {
    // 250 runs of another event: every page is listed and none is kept, so only the check before each page can stop it.
    let clock = Date.parse(started(250)) + H, pages = 0;
    const listing = withRuns(nowhere, Array.from({ length: 250 }, (_, i) => ({ id: i + 1, started: started(i + 1), event: "push" })));
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      if (new URL(String(input)).pathname.endsWith("/workflows/9/runs")) { pages++; clock += 3 * 60_000; }
      return listing(input, init);
    }) as typeof fetch;
    await expect(firstSeen({ repo: "o/r", runId: 250, defaultBranch: "main", ecosystem: "npm", api: "https://api.github.invalid", token: "t0ken", fetchFn, now: () => clock }, [LODASH])).rejects.toThrow("the walk took longer than 5 minutes");
    // 3 minutes per page: the third page would start past the limit.
    expect(pages).toBe(2);
  });
  it("inflates a record with the record's own limit, so a deflated entry cannot allocate more than 1 MiB (R252b N11)", async () => {
    expect(SEEN_BYTES).toBe(1024 * 1024);
    inflateOptions.length = 0;
    const r = await walk(row([{ bytes: zip("seen.json", JSON.stringify(seenAt(started(1), SAW)), { deflate: true }) }, SAW]));
    expect(r.seen.get(LODASH.branch)).toMatchObject({ run: 1, ended: false });
    expect(inflateOptions).toEqual([{ maxOutputLength: SEEN_BYTES }]);
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

  // X7 (definitions.md, section 7): GitHub's times compared with the runner's clock and with the Date of the same answer.
  const http = (ms: number) => new Date(ms).toUTCString();
  it("does not walk when GitHub's start of this run is later than the runner's clock, and says by how much (X7)", async () => {
    // GitHub's run times an hour later than the PR job's clock: this run seems to start after the job that runs in it.
    const runs = row([SAW, SAW]);
    await expect(walk(runs, [LODASH], { now: Date.parse(started(2)) - H })).rejects.toThrow("GitHub's start of this run is 60.0 minutes later than this runner's clock");
    // A second after it, the walk is done.
    expect((await walk(runs, [LODASH], { now: Date.parse(started(2)) + 1000 })).seen.get(LODASH.branch)).toMatchObject({ run: 1 });
  });
  it("does not walk when GitHub's start of this run is later than the Date of GitHub's answer that gives it (X7)", async () => {
    const runs = row([SAW, SAW]);
    await expect(walk(runs, [LODASH], { date: http(Date.parse(started(2)) - 51 * 60_000) })).rejects.toThrow("GitHub's start of this run is 51.0 minutes later than the Date of GitHub's answer that gives it");
    await expect(walk(runs, [LODASH], { date: http(Date.parse(started(2)) - 1000) })).rejects.toThrow("GitHub's start of this run is 1 second later than the Date");
    // The same second as the Date: this run's start is not later, but its artifact, uploaded 10 minutes into it, is.
    expect((await walk(runs, [LODASH], { date: http(Date.parse(started(2))) })).stopped).toEqual({ run: 2, kind: "ahead", ms: 10 * 60_000, branches: [LODASH.branch] });
    // An answer dated later, or a Date that is no date (not compared): the walk is done.
    for (const date of [http(Date.parse(started(2)) + H), "yesterday"]) {
      expect((await walk(runs, [LODASH], { date })).seen.get(LODASH.branch), date).toMatchObject({ run: 1 });
    }
  });
  it("stops at a run whose record's time is outside GitHub's times for it, and says which run and by how much (X7)", async () => {
    // Run 2's start, as GitHub gives it, is an hour after its record's time: GitHub's clock and the runner's differ there.
    const early = row([SAW, { started: iso(Date.parse(started(2)) + H), record: { ...seenAt(started(2), SAW), checked_at: iso(Date.parse(started(2))) } }, SAW]);
    const r = await walk(early);
    expect(r.seen.get(LODASH.branch)).toEqual({ at: iso(Date.parse(started(3)) + 5 * 60_000), run: 3, ended: false });
    expect(r.read).toBe(1);
    expect(r.stopped).toEqual({ run: 2, kind: "early", ms: H, branches: [LODASH.branch] });
    // Run 2's record is an hour after GitHub's upload time of its artifact.
    const late = row([SAW, { record: { ...seenAt(started(2), OTHER), checked_at: iso(Date.parse(started(2)) + 10 * 60_000 + H) } }, SAW]);
    const l = await walk(late);
    expect(l.seen.get(LODASH.branch)).toEqual({ at: iso(Date.parse(started(3)) + 5 * 60_000), run: 3, ended: false });
    expect(l.stopped).toEqual({ run: 2, kind: "late", ms: H, branches: [LODASH.branch] });
    // No record of the row lists the fix before the stop: still said.
    const none = await walk(row([SAW, { started: iso(Date.parse(started(2)) + H), record: { ...seenAt(started(2), SAW), checked_at: iso(Date.parse(started(2))) } }, null]));
    expect(none.seen.get(LODASH.branch)).toBeNull();
    expect(none.stopped).toMatchObject({ run: 2, kind: "early", branches: [LODASH.branch] });
  });
  it("stops at a run whose start or artifact GitHub dates later than its own answer (X7)", async () => {
    // Answers dated 20 minutes after this run's start; run 2's artifact is created 51 minutes after that.
    const date = Date.parse(started(3)) + 20 * 60_000;
    const artifact = row([SAW, { record: seenAt(started(2), SAW), created: iso(date + 51 * 60_000) }, SAW]);
    const a = await walk(artifact, [LODASH], { date: http(date) });
    expect(a.seen.get(LODASH.branch)).toMatchObject({ run: 3, ended: false });
    expect(a.stopped).toEqual({ run: 2, kind: "ahead", ms: 51 * 60_000, branches: [LODASH.branch] });
    // Run 2's start is 51 minutes after the Date of the list that gives it (and its record lies inside its run).
    const start = row([SAW, { started: iso(date + 51 * 60_000), record: seenAt(iso(date + 51 * 60_000), SAW) }, SAW]);
    const s = await walk(start, [LODASH], { date: http(date) });
    expect(s.stopped).toEqual({ run: 2, kind: "ahead", ms: 51 * 60_000, branches: [LODASH.branch] });
    // Without a Date header the same run is read.
    expect((await walk(artifact)).stopped).toBeNull();
  });
  it("a row that has ended before such a run is not stopped by it, and times that agree stop nothing (X7)", async () => {
    const shifted = { started: iso(Date.parse(started(2)) + H), record: { ...seenAt(started(2), SAW), checked_at: iso(Date.parse(started(2))) } };
    const ended = await walk(row([SAW, shifted, OTHER, SAW]));
    expect(ended.seen.get(LODASH.branch)).toEqual({ at: iso(Date.parse(started(4)) + 5 * 60_000), run: 4, ended: true });
    expect(ended.stopped).toBeNull();
    const fine = await walk(row([SAW, SAW, SAW]), [LODASH], { date: http(LATER) });
    expect(fine.stopped).toBeNull();
    expect(fine.seen.get(LODASH.branch)).toEqual({ at: iso(Date.parse(started(1)) + 5 * 60_000), run: 1, ended: false });
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
    expect(failed).toContain("(this run's lookup: earlier runs' records were not used: GitHub did not list this workflow's runs (HTTP 403)");
    expect(failed).not.toContain("| `x`");
  });
  it("says where the walk stopped at a run whose times do not agree, which times and by how much (X7)", () => {
    const stop = (kind: "early" | "late" | "ahead", ms: number) => ({ run: 40, kind, ms });
    const found = pullRequestBody(ARTIFACT, { ...LODASH, found_at: "2026-10-29T00:05:00.000Z", seen: { at: "2026-10-29T00:05:00.000Z", run: 41, read: 1, ended: false, stop: stop("early", H) } });
    expect(found).toContain("| Found | `2026-10-29T00:05:00.000Z` (the check of run `41`, the first of an unbroken row of this workflow's runs whose record lists this fix; `1` records read; the records read end there, so an earlier run may have seen it first; the walk stopped at run `40`, whose times do not agree: its record's time is `60.0` minutes before GitHub's start of that run, so the runs before it were not read) |");
    const none = pullRequestBody(ARTIFACT, { ...LODASH, seen: { at: LODASH.found_at, run: null, read: 0, ended: false, stop: stop("late", 90_000) } });
    expect(none).toContain("| Found | `2026-10-30T01:00:00.000Z` (this run's lookup: no record read lists this fix; `0` records read; the walk stopped at run `40`, whose times do not agree: its record's time is `1.5` minutes after GitHub's upload time of its record, so the runs before it were not read) |");
    const earlier = pullRequestBody(ARTIFACT, { ...LODASH, seen: { at: LODASH.found_at, run: null, read: 2, ended: false, earlier: true, stop: stop("ahead", 51 * 60_000) } });
    expect(earlier).toContain("(this run's lookup, earlier than the record of every run that lists this fix; `2` records read; the walk stopped at run `40`, whose times do not agree: GitHub's time for that run is `51.0` minutes later than the Date of GitHub's answer that gives it, so the runs before it were not read) |");
    const seconds = pullRequestBody(ARTIFACT, { ...LODASH, seen: { at: LODASH.found_at, run: null, read: 0, ended: false, stop: stop("ahead", 1000) } });
    expect(seconds).toContain("GitHub's time for that run is `1` second later than the Date");
  });
});
