// Lane LT: checks of the pure helpers in lib.ts, run before every phase (run.sh). Exits non-zero on a failure.
import { archiveUrl, inWindow, outcome, reachability, repoOfLine, windowHours } from "./lib.ts";

let failed = 0;
const eq = (what: string, got: unknown, want: unknown) => { if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.log(`FAIL ${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };

// §4: the window's hours and files.
const w = windowHours("2025-09-08T13:16:00.000Z");
eq("window length", w.length, 49);
eq("window first", new Date(w[0]!).toISOString(), "2025-09-07T13:00:00.000Z");
eq("window last", new Date(w.at(-1)!).toISOString(), "2025-09-09T13:00:00.000Z");
eq("window on the hour", windowHours("2025-09-08T13:00:00.000Z").length, 49);
eq("file name", archiveUrl(Date.parse("2025-09-08T03:00:00Z")), "https://data.gharchive.org/2025-09-08-3.json.gz");
eq("file name two digits", archiveUrl(Date.parse("2025-01-02T23:00:00Z")), "https://data.gharchive.org/2025-01-02-23.json.gz");
eq("in window start", inWindow("2025-09-08T13:16:00Z", "2025-09-07T13:16:00Z"), true);
eq("before window", inWindow("2025-09-08T13:16:00Z", "2025-09-07T13:15:59Z"), false);
eq("in window end", inWindow("2025-09-08T13:16:00Z", "2025-09-09T13:16:00Z"), true);
eq("after window", inWindow("2025-09-08T13:16:00Z", "2025-09-09T13:16:01Z"), false);

// §4: the repository of a line.
eq("repo of line", repoOfLine('{"id":"1","type":"CreateEvent","actor":{"id":2,"login":"a"},"repo":{"id":123,"name":"Owner/Repo","url":"x"},"payload":{}}'), { id: 123, name: "Owner/Repo" });
eq("repo of line, other shape", repoOfLine('{"repo":{"name":"a/b","id":1}}'), null);
eq("repo of line, none", repoOfLine('{"id":"1"}'), null);

// §5: compare.
eq("identical", reachability("identical"), "reachable");
eq("behind", reachability("behind"), "reachable");
eq("ahead", reachability("ahead"), "not reachable");
eq("diverged", reachability("diverged"), "not reachable");
eq("error", reachability("HTTP 404"), "unknown");

// §8: outcomes.
const base = { prevRepo: "github" as const, tagNow: false, refsReachable: true, atTheTime: "no tag event" as const, provenance: false };
eq("tag now", outcome({ ...base, tagNow: true }), "tied: tag now");
eq("tag at the time", outcome({ ...base, atTheTime: "tag created at the time" }), "tied: tag at the time only");
eq("provenance", outcome({ ...base, provenance: true }), "tied: provenance only");
eq("provenance without a repository", outcome({ ...base, prevRepo: "no repository", atTheTime: null, provenance: true }), "tied: provenance only");
eq("no repository", outcome({ ...base, prevRepo: "no repository", atTheTime: null }), "not tied: P names no repository");
eq("not obtained", outcome({ ...base, prevRepo: "not obtained", atTheTime: null }), "not tied: P not obtained");
eq("not GitHub", outcome({ ...base, prevRepo: "not GitHub", atTheTime: null }), "not tied: P's repository not GitHub");
eq("no tag event", outcome(base), "not tied: no tag now, no tag event (repository reachable now)");
eq("no tag event, gone", outcome({ ...base, refsReachable: false }), "not tied: no tag now, no tag event (repository not reachable now)");
eq("not fully checked", outcome({ ...base, atTheTime: "not fully checked" }), "unknown: no tag now, window not fully checked");
eq("not looked up", outcome({ ...base, atTheTime: null }), "unknown: no tag now, GH Archive not looked up");

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("selftest passed");
