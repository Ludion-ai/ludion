import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Inventory } from "../src/security/inventory.ts";
import { OsvClient, type ReadOnlyScan } from "../src/security/osv.ts";
import { readConfig } from "../src/security/project.ts";
import { scanProject, vulnerable } from "../src/security/scan.ts";
import { readOnlyText, securityCli } from "../src/security/cli.ts";
import { GO_FILES, PYTHON_FILES, READONLY_READERS, RUST_FILES, type ReadOnlyReader } from "../src/security/readonly/index.ts";
import type { ReadOnlyInventory } from "../src/security/readonly/types.ts";

const response = (value: unknown) => new Response(JSON.stringify(value));
const pypi = (packages: ReadOnlyInventory["packages"], limitations: string[] = []): ReadOnlyInventory => ({ ecosystem: "PyPI", files: ["requirements.txt"], scope: "pinned_requirements", packages, limitations });
const django = { name: "django", version: "3.2.0", direct: true };
const requests = { name: "requests", version: "2.31.0", direct: true };
const record = (id: string, extra: Record<string, unknown> = {}) => ({
  id, summary: "Example advisory\u001b[2J", aliases: ["CVE-2026-0003"],
  affected: [
    // OSV writes PyPI names normalized; the inventory keeps the project's spelling.
    { package: { ecosystem: "PyPI", name: "Django" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "3.2" }, { fixed: "3.2.13" }] }, { type: "GIT", repo: "https://github.com/django/django", events: [{ introduced: "0" }, { fixed: "a".repeat(40) }] }] },
    { package: { ecosystem: "PyPI", name: "django" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "4.0" }, { fixed: "4.0.4" }, { fixed: "3.2.13" }] }] },
    { package: { ecosystem: "PyPI", name: "django-other" }, ranges: [{ type: "ECOSYSTEM", events: [{ fixed: "9.9.9" }] }] },
    { package: { ecosystem: "Go", name: "django" }, ranges: [{ type: "SEMVER", events: [{ fixed: "8.8.8" }] }] },
  ],
  ...extra,
});
/** A fake OSV: the advisory ids for each name@version, and the records by id. Every request is kept. */
function osv(vulnerable: Record<string, string[]>, records: Record<string, unknown> = {}, seen: { url: string; body?: string }[] = []): OsvClient {
  return new OsvClient(async (url, init) => {
    seen.push({ url: String(url), ...(init?.body ? { body: String(init.body) } : {}) });
    const id = decodeURIComponent(String(url).split("/vulns/")[1] ?? "");
    if (id) return records[id] ? response(records[id]) : new Response("", { status: 404 });
    const queries = JSON.parse(String(init?.body)).queries;
    return response({ results: queries.map((q: any) => (vulnerable[`${q.package.name}@${q.version}`] ?? []).length ? { vulns: vulnerable[`${q.package.name}@${q.version}`]!.map(id => ({ id, modified: "2026-01-01T00:00:00Z" })) } : {}) });
  });
}

describe("OSV for read-only inventories", () => {
  it("reports OSV's matches with OSV's fixed versions as plain strings, and nothing to plan or apply", async () => {
    const seen: { url: string; body?: string }[] = [];
    const result = await osv({ "django@3.2.0": ["GHSA-aaaa-bbbb-cccc"] }, { "GHSA-aaaa-bbbb-cccc": record("GHSA-aaaa-bbbb-cccc") }, seen).scanReadOnly(pypi([django, requests]));
    // Only names and versions, under OSV's ecosystem name.
    expect(seen[0]).toEqual({ url: "https://api.osv.dev/v1/querybatch", body: JSON.stringify({ queries: [{ package: { ecosystem: "PyPI", name: "django" }, version: "3.2.0" }, { package: { ecosystem: "PyPI", name: "requests" }, version: "2.31.0" }] }) });
    expect(seen[1]?.url).toBe("https://api.osv.dev/v1/vulns/GHSA-aaaa-bbbb-cccc");
    expect(result.status).toBe("vulnerabilities_found");
    expect(Object.keys(result).sort()).toEqual(["checked_at", "findings", "fixed_versions_note", "inventory", "note", "schema", "source", "status"]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.package).toEqual(django);
    // Both normalized spellings of the name, ECOSYSTEM ranges only (the GIT range's commit is not a version), other
    // packages and ecosystems left out, OSV's order, no comparison.
    expect(result.findings[0]!.fixed_versions).toEqual(["3.2.13", "4.0.4"]);
    expect(result.findings[0]!.advisory.summary).toBe("Example advisory [2J");
    expect(result.note).toContain("does not plan or apply updates");
    expect(result.fixed_versions_note).toContain("does not compare them");
  });
  it("uses OSV's names for Go and crates.io, and compares their package names exactly", async () => {
    const seen: { url: string; body?: string }[] = [];
    const go = { ...record("GO-2026-0001"), affected: [{ package: { ecosystem: "Go", name: "golang.org/x/net" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "0.38.0" }] }] }, { package: { ecosystem: "Go", name: "golang.org/x/Net" }, ranges: [{ type: "SEMVER", events: [{ fixed: "9.0.0" }] }] }] };
    const result = await osv({ "golang.org/x/net@0.7.0": ["GO-2026-0001"] }, { "GO-2026-0001": go }, seen).scanReadOnly({ ecosystem: "Go", files: ["go.mod"], scope: "go_mod_requirements", limitations: [], packages: [{ name: "golang.org/x/net", version: "0.7.0", direct: false }] });
    expect(JSON.parse(seen[0]!.body!).queries[0].package).toEqual({ ecosystem: "Go", name: "golang.org/x/net" });
    expect(result.findings[0]!.fixed_versions).toEqual(["0.38.0"]);
    const crates = await osv({}, {}, seen).scanReadOnly({ ecosystem: "crates.io", files: ["Cargo.lock"], scope: "locked", limitations: [], packages: [{ name: "smallvec", version: "1.6.0", direct: true }] });
    expect(JSON.parse(seen.at(-1)!.body!).queries[0].package).toEqual({ ecosystem: "crates.io", name: "smallvec" });
    expect(crates.status).toBe("no_known_vulnerabilities");
  });
  it("is incomplete whenever the inventory has limitations and there are no findings", async () => {
    expect((await osv({}).scanReadOnly(pypi([django], ["Unpinned requirement: flask>=2."]))).status).toBe("incomplete");
    expect((await osv({}).scanReadOnly(pypi([], ["Unpinned requirement: flask>=2."]))).status).toBe("incomplete");
    expect((await osv({}).scanReadOnly(pypi([django]))).status).toBe("no_known_vulnerabilities");
    const found = await osv({ "django@3.2.0": ["GHSA-aaaa-bbbb-cccc"] }, { "GHSA-aaaa-bbbb-cccc": record("GHSA-aaaa-bbbb-cccc") }).scanReadOnly(pypi([django], ["Unpinned requirement: flask>=2."]));
    expect(found.status).toBe("vulnerabilities_found");
  });
  it("leaves withdrawn advisories out", async () => {
    const records = { "GHSA-aaaa-bbbb-cccc": record("GHSA-aaaa-bbbb-cccc", { withdrawn: "2026-02-01T00:00:00Z" }), "PYSEC-2026-1": record("PYSEC-2026-1") };
    const result = await osv({ "django@3.2.0": ["GHSA-aaaa-bbbb-cccc", "PYSEC-2026-1"] }, records).scanReadOnly(pypi([django]));
    expect(result.findings.map(f => f.advisory.id)).toEqual(["PYSEC-2026-1"]);
    const none = await osv({ "django@3.2.0": ["GHSA-aaaa-bbbb-cccc"] }, records).scanReadOnly(pypi([django]));
    expect(none.findings).toEqual([]); expect(none.status).toBe("no_known_vulnerabilities");
  });
  it("lists no fixed version when OSV gives none, rather than inventing one", async () => {
    const open = { ...record("GHSA-aaaa-bbbb-cccc"), affected: [{ package: { ecosystem: "PyPI", name: "django" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { last_affected: "3.2.0" }] }] }] };
    const result = await osv({ "django@3.2.0": ["GHSA-aaaa-bbbb-cccc"] }, { "GHSA-aaaa-bbbb-cccc": open }).scanReadOnly(pypi([django]));
    expect(result.findings[0]!.fixed_versions).toEqual([]);
  });
  it("reads every page and asks once for a package listed twice", async () => {
    let batches = 0;
    const tokens: (string | undefined)[] = [];
    const client = new OsvClient(async (url, init) => {
      if (String(url).includes("/vulns/")) return response(record(decodeURIComponent(String(url).split("/vulns/")[1]!)));
      batches++;
      const queries = JSON.parse(String(init?.body)).queries;
      tokens.push(...queries.map((q: any) => q.page_token));
      return response({ results: queries.map((q: any) => q.page_token === "two" ? { vulns: [{ id: "PYSEC-2026-2" }] } : q.page_token ? { vulns: [{ id: "PYSEC-2026-1" }], next_page_token: "two" } : { next_page_token: "one" }) });
    });
    const result = await client.scanReadOnly(pypi([django, { ...django, direct: false }]));
    expect(batches).toBe(3); expect(tokens).toEqual([undefined, "one", "two"]);
    expect(result.findings.map(f => f.advisory.id)).toEqual(["PYSEC-2026-1", "PYSEC-2026-2"]);
  });
  it.each([
    ["an outage", async () => new Response("", { status: 503 }), "HTTP 503"],
    ["a short batch", async () => response({ results: [] }), "count mismatch"],
    ["an error item", async () => response({ results: [{ error: "quota" }] }), "Invalid OSV batch item"],
    ["an unsafe id", async () => response({ results: [{ vulns: [{ id: "../../private" }] }] }), "advisory id"],
    ["a repeated page token", async () => response({ results: [{ next_page_token: "same" }] }), "repeated"],
    ["a non-object body", async () => response([]), "Invalid OSV response"],
  ] as const)("does not turn %s into a clean result", async (_name, fetchFn, error) => {
    await expect(new OsvClient(fetchFn as typeof fetch).scanReadOnly(pypi([django]))).rejects.toThrow(error);
  });
  it.each([
    ["a mismatched record", { ...record("GHSA-aaaa-bbbb-cccc"), id: "GHSA-other" }, "Incomplete OSV advisory record"],
    ["a missing advisory", undefined, "HTTP 404"],
    ["a fixed version with control characters", { ...record("GHSA-aaaa-bbbb-cccc"), affected: [{ package: { ecosystem: "PyPI", name: "django" }, ranges: [{ type: "ECOSYSTEM", events: [{ fixed: "3.2.13\u001b[31m" }] }] }] }, "Invalid fixed version"],
    ["a non-string fixed version", { ...record("GHSA-aaaa-bbbb-cccc"), affected: [{ package: { ecosystem: "PyPI", name: "django" }, ranges: [{ type: "ECOSYSTEM", events: [{ fixed: 3 }] }] }] }, "Invalid fixed version"],
    ["malformed range events", { ...record("GHSA-aaaa-bbbb-cccc"), affected: [{ package: { ecosystem: "PyPI", name: "django" }, ranges: [{ type: "ECOSYSTEM", events: { fixed: "1" } }] }] }, "Invalid range"],
    ["an invalid withdrawal time", record("GHSA-aaaa-bbbb-cccc", { withdrawn: "soon" }), "withdrawal"],
  ])("refuses %s in an advisory", async (_name, body, error) => {
    await expect(osv({ "django@3.2.0": ["GHSA-aaaa-bbbb-cccc"] }, body ? { "GHSA-aaaa-bbbb-cccc": body } : {}).scanReadOnly(pypi([django]))).rejects.toThrow(error);
  });
  it("refuses an inventory it cannot send as exact names and versions, before any request", async () => {
    const seen: { url: string }[] = [];
    const client = osv({}, {}, seen);
    for (const pkg of [{ name: "django\u001b", version: "1", direct: true }, { name: "django", version: "1 ; extra", direct: true }, { name: "", version: "1", direct: true }, { name: "x".repeat(241), version: "1", direct: true }, { name: "django", version: 1, direct: true }]) {
      await expect(client.scanReadOnly(pypi([pkg as never]))).rejects.toThrow("Invalid PyPI package coordinate");
    }
    await expect(client.scanReadOnly({ ...pypi([django]), ecosystem: "npm" as never })).rejects.toThrow("Invalid read-only inventory");
    await expect(client.scanReadOnly(pypi(Array.from({ length: 2001 }, (_, i) => ({ name: `p${i}`, version: "1.0", direct: true }))))).rejects.toThrow("2,000");
    expect(seen).toEqual([]);
  });
  const names = {
    PyPI: { valid: ["requests", "Flask_Cors", "zope.interface", "a", "A1"], invalid: ["requests[security]", "requests>=2", "requests;python_version<'3'", "-requests", "requests-", "requests.", "a b", "requests@2", "x".repeat(241)] },
    Go: { valid: ["golang.org/x/net", "github.com/Foo/Bar", "gopkg.in/yaml.v3", "example.com/a~b/v2", "stdlib", "toolchain"], invalid: ["Golang.org/x/net", "golang/x", "-x.org/a", "golang.org//x", "golang.org/x/", "/golang.org/x", "golang.org/.x", "golang.org/x.", "golang.org/x/net@v1.0.0", "../x", "std", "golang.org/x net"] },
    "crates.io": { valid: ["serde_json", "tokio-util", "a", "x".repeat(64)], invalid: ["serde json", "serde/json", "serde.json", "serde[derive]", "x".repeat(65)] },
  } as const;
  it.each(Object.entries(names))("accepts only real %s names, and fails closed before any request on anything else", async (ecosystem, { valid, invalid }) => {
    const seen: { url: string }[] = [];
    const client = osv({}, {}, seen);
    const inventory = (name: string): ReadOnlyInventory => ({ ecosystem: ecosystem as ReadOnlyInventory["ecosystem"], files: ["x"], scope: "test", limitations: [], packages: [{ name, version: "1.0.0", direct: true }] });
    for (const name of invalid) await expect(client.scanReadOnly(inventory(name)), name).rejects.toThrow(`Invalid ${ecosystem} package coordinate ${JSON.stringify(`${name.slice(0, 100)}@1.0.0`)}`);
    expect(seen).toEqual([]);
    for (const name of valid) expect((await client.scanReadOnly(inventory(name))).status, name).toBe("no_known_vulnerabilities");
    expect(seen).toHaveLength(valid.length);
  });
  it("asks once for one PyPI package however its name is spelled, and keeps it direct if any entry is", async () => {
    const seen: { url: string; body?: string }[] = [];
    const result = await osv({ "django@3.2.0": ["GHSA-aaaa-bbbb-cccc"] }, { "GHSA-aaaa-bbbb-cccc": record("GHSA-aaaa-bbbb-cccc") }, seen).scanReadOnly(pypi([{ ...django, direct: false }, { name: "Django", version: "3.2.0", direct: true }, { name: "DJANGO", version: "3.2.0", direct: false }, { name: "django", version: "4.0.0", direct: false }]));
    expect(JSON.parse(seen[0]!.body!).queries).toEqual([{ package: { ecosystem: "PyPI", name: "django" }, version: "3.2.0" }, { package: { ecosystem: "PyPI", name: "django" }, version: "4.0.0" }]);
    expect(result.findings.map(f => f.package)).toEqual([{ name: "django", version: "3.2.0", direct: true }]);
    // Go and crates.io names are not normalized: two spellings are two queries.
    const goSeen: { url: string; body?: string }[] = [];
    await osv({}, {}, goSeen).scanReadOnly({ ecosystem: "Go", files: ["go.mod"], scope: "test", limitations: [], packages: [{ name: "github.com/foo/bar", version: "1.0.0", direct: true }, { name: "github.com/Foo/Bar", version: "1.0.0", direct: true }] });
    expect(JSON.parse(goSeen[0]!.body!).queries).toHaveLength(2);
  });
  it("is linear in the fixed events of one record", async () => {
    const events = Array.from({ length: 100_000 }, (_, i) => ({ fixed: `1.${i}` }));
    const huge = { ...record("GHSA-aaaa-bbbb-cccc"), affected: [{ package: { ecosystem: "PyPI", name: "django" }, ranges: [{ type: "ECOSYSTEM", events: [...events, ...events.slice(0, 1000)] }] }] };
    const result = await osv({ "django@3.2.0": ["GHSA-aaaa-bbbb-cccc"] }, { "GHSA-aaaa-bbbb-cccc": huge }).scanReadOnly(pypi([django]));
    expect(result.findings[0]!.fixed_versions).toHaveLength(100_000);
  });
});

describe("RustSec informational advisories are listed apart from vulnerabilities", () => {
  const atty = { name: "atty", version: "0.2.14", direct: true };
  const crates = (limitations: string[] = []): ReadOnlyInventory => ({ ecosystem: "crates.io", files: ["Cargo.lock"], scope: "locked", packages: [atty], limitations });
  // As OSV writes them (checked live: RUSTSEC-2024-0375, RUSTSEC-2021-0145, GHSA-g98v-hv3f-hcfr).
  const rustsec = (id: string, informational: unknown, aliases: string[] = [], extra: Record<string, unknown>[] = [], crate = "atty") => ({
    id, summary: `${id} summary`, aliases,
    affected: [{ package: { ecosystem: "crates.io", name: crate }, ranges: [{ type: "SEMVER", events: [{ introduced: "0.0.0-0" }] }], database_specific: { categories: [], cvss: null, informational } }, ...extra],
  });
  const records = {
    "RUSTSEC-2024-0375": rustsec("RUSTSEC-2024-0375", "unmaintained"),
    "RUSTSEC-2021-0145": rustsec("RUSTSEC-2021-0145", "unsound", ["GHSA-g98v-hv3f-hcfr"]),
    "GHSA-g98v-hv3f-hcfr": { ...rustsec("GHSA-g98v-hv3f-hcfr", undefined, ["RUSTSEC-2021-0145"]), affected: [{ package: { ecosystem: "crates.io", name: "atty" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { last_affected: "0.2.14" }] }], database_specific: { source: "https://github.com/github/advisory-database" } }] },
    "RUSTSEC-2020-0036": rustsec("RUSTSEC-2020-0036", "unmaintained", ["CVE-2019-25010", "GHSA-jq66-xh47-j9f3"]),
    // Live: salsa 0.28.0's use-after-free, marked unsound, whose alias GHSA-xc3w-55vh-cw3w OSV does not have.
    "RUSTSEC-2026-0308": rustsec("RUSTSEC-2026-0308", "unsound", ["GHSA-xc3w-55vh-cw3w"], [], "salsa"),
    "RUSTSEC-2099-0001": rustsec("RUSTSEC-2099-0001", "something-new"),
    "RUSTSEC-2099-0002": rustsec("RUSTSEC-2099-0002", "unmaintained", [], [{ package: { ecosystem: "crates.io", name: "atty" }, ranges: [], database_specific: { informational: null } }]),
    "RUSTSEC-2099-0003": rustsec("RUSTSEC-2099-0003", "notice", [], [{ package: { ecosystem: "crates.io", name: "other" }, ranges: [] }]),
    "RUSTSEC-2099-0004": rustsec("RUSTSEC-2099-0004", "unsound"),
    "RUSTSEC-2099-0005": rustsec("RUSTSEC-2099-0005", "unmaintained", ["GHSA-aaaa-bbbb-cccc"]),
    // OSV returned it for atty, but its only entry names another crate.
    "RUSTSEC-2099-0006": rustsec("RUSTSEC-2099-0006", "notice", [], [], "other"),
    "GHSA-2099-0007-aaaa": { ...rustsec("GHSA-2099-0007-aaaa", "unmaintained"), id: "GHSA-2099-0007-aaaa" },
  };
  const scan = (ids: string[], inventory = crates()) => osv({ "atty@0.2.14": ids }, records).scanReadOnly(inventory);

  it("does not count unmaintained or notice records without a CVE or GHSA alias as vulnerabilities", async () => {
    const result = await scan(["RUSTSEC-2024-0375", "RUSTSEC-2099-0003"]);
    expect(result.findings.map(f => [f.advisory.id, f.kind, f.kind === "informational" ? f.informational : null])).toEqual([["RUSTSEC-2024-0375", "informational", "unmaintained"], ["RUSTSEC-2099-0003", "informational", "notice"]]);
    expect(result.status).toBe("no_known_vulnerabilities");
    expect(result.note).toContain('kind "informational"');
    expect((await scan(["RUSTSEC-2024-0375"], crates(["Cargo.toml: a git dependency is not checked."]))).status).toBe("incomplete");
  });
  it("still counts a vulnerability next to them, and lists both", async () => {
    const result = await scan(["GHSA-g98v-hv3f-hcfr", "RUSTSEC-2024-0375"]);
    expect(result.findings.map(f => [f.advisory.id, f.kind])).toEqual([["GHSA-g98v-hv3f-hcfr", "vulnerability"], ["RUSTSEC-2024-0375", "informational"]]);
    expect(result.status).toBe("vulnerabilities_found");
    expect(readOnlyText("crates.io", result).slice(0, 3)).toEqual([
      "crates.io: 1 package versions · 1 advisory matches · 1 informational · vulnerabilities_found",
      "  atty@0.2.14 · GHSA-g98v-hv3f-hcfr · GHSA-g98v-hv3f-hcfr summary · OSV lists no fixed version",
      "  Informational (unmaintained, not counted as a vulnerability): atty@0.2.14 · RUSTSEC-2024-0375 · RUSTSEC-2024-0375 summary · OSV lists no fixed version",
    ]);
  });
  it("counts an unsound record whose GHSA alias OSV does not have as a vulnerability (salsa 0.28.0)", async () => {
    const salsa: ReadOnlyInventory = { ...crates(), packages: [{ name: "salsa", version: "0.28.0", direct: true }] };
    const result = await osv({ "salsa@0.28.0": ["RUSTSEC-2026-0308"] }, records).scanReadOnly(salsa);
    expect(result.findings.map(f => [f.advisory.id, f.kind])).toEqual([["RUSTSEC-2026-0308", "vulnerability"]]);
    expect(result.status).toBe("vulnerabilities_found");
  });
  it.each([
    ["names a CVE", "RUSTSEC-2020-0036"],
    ["is unsound and has a GHSA alias", "RUSTSEC-2021-0145"],
    ["is unsound, with no alias", "RUSTSEC-2099-0004"],
    ["is unmaintained and has a GHSA alias", "RUSTSEC-2099-0005"],
    ["has a kind Ludion does not know", "RUSTSEC-2099-0001"],
    ["is informational for only one of the package's entries", "RUSTSEC-2099-0002"],
    ["has no entry for the queried crate", "RUSTSEC-2099-0006"],
    ["is not a RUSTSEC record", "GHSA-2099-0007-aaaa"],
  ])("counts a record that %s as a vulnerability", async (_name, id) => {
    const result = await scan([id]);
    expect(result.findings.map(f => f.kind)).toEqual(["vulnerability"]); expect(result.status).toBe("vulnerabilities_found");
  });
  it("reads the informational kind for crates.io only", async () => {
    // A RUSTSEC id on purpose, so only the ecosystem rule decides.
    const pypiRecord = { ...record("RUSTSEC-2099-0008"), aliases: [], affected: [{ package: { ecosystem: "PyPI", name: "django" }, ranges: [], database_specific: { informational: "unmaintained" } }] };
    const result = await osv({ "django@3.2.0": ["RUSTSEC-2099-0008"] }, { "RUSTSEC-2099-0008": pypiRecord }).scanReadOnly(pypi([django]));
    expect(result.findings[0]!.kind).toBe("vulnerability");
  });
  it("leaves an informational-only project clean in scan, and a vulnerability still needs attention", async () => {
    const root = project({ "Cargo.lock": "version = 4\n" });
    const reader = fakeReader(() => crates(), "crates.io", RUST_FILES);
    const clean = await scanProject(root, undefined, { readers: [reader], client: osv({ "atty@0.2.14": ["RUSTSEC-2024-0375"] }, records) });
    expect(clean.status).toBe("no_known_updates");
    expect(clean.checks.every(c => "result" in c && !vulnerable(c.result as ReadOnlyScan))).toBe(true);
    const found = await scanProject(root, undefined, { readers: [reader], client: osv({ "atty@0.2.14": ["RUSTSEC-2024-0375", "GHSA-g98v-hv3f-hcfr"] }, records) });
    expect(found.status).toBe("attention_required");
    expect(found.checks.every(c => "result" in c && vulnerable(c.result as ReadOnlyScan))).toBe(true);
  });
});

describe("npm, Composer and Maven queries are unchanged", () => {
  it.each([
    ["npm", "lodash", "4.17.20", "npm"],
    ["composer", "symfony/http-foundation", "5.4.10", "Packagist"],
    ["maven", "org.apache.commons:commons-text", "1.9", "Maven"],
  ] as const)("%s sends the same batch body", async (ecosystem, name, version, osvName) => {
    const bodies: string[] = [];
    const client = new OsvClient(async (url, init) => {
      if (String(url).startsWith("https://packagist.org/")) return response({ advisories: {} });
      bodies.push(String(init?.body));
      return response({ results: [{}] });
    });
    const installed: Inventory = { ecosystem, files: [], scope: "locked_dependencies", limitations: [], packages: [{ ecosystem, name, version, direct: true }] };
    const result = await client.scan(installed);
    expect(bodies).toEqual([`{"queries":[{"package":{"ecosystem":"${osvName}","name":"${name}"},"version":"${version}"}]}`]);
    expect(result.status).toBe("no_known_vulnerabilities");
  });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ludion-readonly-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
}
const fakeReader = (read: ReadOnlyReader["read"], ecosystem: ReadOnlyReader["ecosystem"] = "PyPI", files = PYTHON_FILES): ReadOnlyReader => ({ ecosystem, files, read });
const LEGACY = ["requirements.txt", "pyproject.toml", "go.mod", "Cargo.lock", "build.gradle", "build.gradle.kts"];

describe("scan with read-only readers", () => {
  const before = [...READONLY_READERS];
  afterEach(() => expect(READONLY_READERS).toEqual(before));

  it("keeps today's unsupported list and behaviour while no reader is registered", async () => {
    const all = Object.fromEntries([...LEGACY, ...PYTHON_FILES, ...GO_FILES, ...RUST_FILES].map(f => [f, "x\n"]));
    const result = await scanProject(project(all), undefined, { readers: [], client: osv({}) });
    expect(result.checks).toEqual([]);
    expect(result.unsupported).toEqual(LEGACY);
    expect(result.status).toBe("attention_required");
    // Files outside today's list are not reported, as before.
    await expect(scanProject(project({ "poetry.lock": "", "uv.lock": "", "Pipfile.lock": "", "Cargo.toml": "" }), undefined, { readers: [] })).rejects.toThrow(/^No supported project inventory found\. Expected PHP Dockerfile, npm lockfile, composer\.lock or pom\.xml\.$/);
    expect((await scanProject(project({ "requirements.txt": "x\n" }), "auto", { readers: [] })).unsupported).toEqual(["requirements.txt"]);
  });
  it("adds a check for a registered reader and removes only the files it handled from unsupported", async () => {
    const root = project({ "requirements.txt": "django==3.2.0\n", "pyproject.toml": "[project]\n", "go.mod": "module x\n", "build.gradle": "", "build.gradle.kts": "" });
    const reader = fakeReader(() => ({ ...pypi([django]), files: ["requirements.txt", "pyproject.toml"] }));
    const result = await scanProject(root, undefined, { readers: [reader], client: osv({ "django@3.2.0": ["GHSA-aaaa-bbbb-cccc"] }, { "GHSA-aaaa-bbbb-cccc": record("GHSA-aaaa-bbbb-cccc") }) });
    expect(result.checks).toHaveLength(1);
    const check = result.checks[0]!;
    expect(check.ecosystem).toBe("PyPI");
    expect("result" in check && "fixed_versions_note" in check.result && check.result.findings[0]!.fixed_versions).toEqual(["3.2.13", "4.0.4"]);
    expect(result.unsupported).toEqual(["go.mod", "build.gradle", "build.gradle.kts"]);
    expect(result.status).toBe("attention_required");
  });
  it("is clean only when the reader read everything and OSV knows no advisory", async () => {
    const root = project({ "Cargo.lock": "version = 4\n", "Cargo.toml": "[package]\n" });
    const reader = fakeReader(() => ({ ecosystem: "crates.io", files: ["Cargo.lock", "Cargo.toml"], scope: "locked", packages: [{ name: "smallvec", version: "1.6.1", direct: true }], limitations: [] }), "crates.io", RUST_FILES);
    const result = await scanProject(root, undefined, { readers: [reader], client: osv({}) });
    expect(result.status).toBe("no_known_updates"); expect(result.unsupported).toEqual([]);
  });
  it("adds a limitation for a present file the reader neither read nor explained", async () => {
    const root = project({ "poetry.lock": "", "pyproject.toml": "", "requirements.txt": "" });
    const reader = fakeReader(() => ({ ...pypi([django], ["requirements.txt is ignored because poetry.lock is present."]), files: ["poetry.lock"] }));
    const check = (await scanProject(root, undefined, { readers: [reader], client: osv({}) })).checks[0]!;
    expect("result" in check && check.result.status).toBe("incomplete");
    expect("result" in check && "fixed_versions_note" in check.result && check.result.inventory.limitations).toEqual(["requirements.txt is ignored because poetry.lock is present.", "pyproject.toml is present but was not read."]);
  });
  it.each([
    ["throws", () => { throw new Error("requirements.txt line 3: unreadable"); }, "requirements.txt line 3: unreadable"],
    ["returns nothing for a present file", () => null, "returned no inventory"],
    ["returns another ecosystem", () => ({ ...pypi([django]), ecosystem: "Go" as const }), "returned a Go inventory"],
    ["reads a path outside the project", () => ({ ...pypi([django]), files: ["../outside.txt"] }), "escapes the project"],
  ])("reports an error check when the reader %s, never a clean result", async (_name, read, error) => {
    const result = await scanProject(project({ "requirements.txt": "x\n" }), undefined, { readers: [fakeReader(read as ReadOnlyReader["read"])], client: osv({}) });
    expect(result.checks).toEqual([{ ecosystem: "PyPI", error: expect.stringContaining(error) }]);
    expect(result.unsupported).toEqual([]);
    expect(result.status).toBe("attention_required");
  });
  it("refuses a result when a dependency file changes while it is read or looked up", async () => {
    const root = project({ "requirements.txt": "django==3.2.0\n" });
    const whileReading = fakeReader(r => { writeFileSync(join(r, "requirements.txt"), "django==9\n"); return pypi([django]); });
    expect((await scanProject(root, undefined, { readers: [whileReading], client: osv({}) })).checks).toEqual([{ ecosystem: "PyPI", error: "Dependency files changed during the scan." }]);
    const client = new OsvClient(async () => { writeFileSync(join(root, "requirements.txt"), "django==10\n"); return response({ results: [{}] }); });
    expect((await scanProject(root, undefined, { readers: [fakeReader(() => pypi([django]))], client })).checks).toEqual([{ ecosystem: "PyPI", error: "Dependency files changed during the scan." }]);
  });
  it("selects one read-only ecosystem with --ecosystem and says when it cannot be checked", async () => {
    const root = project({ "go.mod": "module x\n", "requirements.txt": "x\n", "package-lock.json": "{}", "package.json": "{}" });
    let goRuns = 0;
    const go = fakeReader(() => { goRuns++; return { ecosystem: "Go", files: ["go.mod"], scope: "go_mod", packages: [], limitations: [] }; }, "Go", GO_FILES);
    const python = fakeReader(() => { throw new Error("python reader must not run"); });
    const selected = await scanProject(root, "go", { readers: [python, go], client: osv({}) });
    expect(selected.checks.map(c => c.ecosystem)).toEqual(["Go"]); expect(goRuns).toBe(1);
    expect(selected.unsupported).toEqual([]); expect(selected.status).toBe("no_known_updates");
    expect((await scanProject(root, "rust", { readers: [go], client: osv({}) })).checks).toEqual([{ ecosystem: "crates.io", error: "No rust inventory found, and this build has no rust reader." }]);
    expect((await scanProject(root, "python", { readers: [] })).checks).toEqual([{ ecosystem: "PyPI", error: "requirements.txt present, but this build has no python reader; not checked." }]);
    expect((await scanProject(project({ "package.json": "{}" }), "go", { readers: [go] })).checks).toEqual([{ ecosystem: "Go", error: "No go inventory found; expected go.mod at the project root." }]);
    await expect(scanProject(root, "toString", { readers: [] })).rejects.toThrow("Supported ecosystems");
  });
});

describe("the CLI keeps read-only ecosystems out of update policies", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each(["init", "patch", "watch"])("%s refuses python, go and rust", async command => {
    for (const ecosystem of ["python", "go", "rust"]) {
      const root = project({ "requirements.txt": "x\n", "go.mod": "module x\n", "Cargo.lock": "" });
      await expect(securityCli(command, ["--dir", root, "--ecosystem", ecosystem])).rejects.toThrow(`${ecosystem} is read-only: ludion scan reports its known advisories, but Ludion has no update policy for it, so init, patch and watch do not accept it.`);
      expect(readdirSync(root).sort()).toEqual(["Cargo.lock", "go.mod", "requirements.txt"]);
    }
  });
  it("a saved policy cannot name a read-only ecosystem", () => {
    for (const ecosystem of ["python", "PyPI", "go", "crates.io"]) {
      const root = project({ "ludion.security.json": JSON.stringify({ schema: 1, ecosystem, test: ["pytest"], timeout_seconds: 30 }) });
      expect(() => readConfig(root)).toThrow(`${ecosystem} is read-only`);
    }
  });
  it("scan accepts the read-only names and reports a check it could not make as an error (exit 2)", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => { errors.push(line); });
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await securityCli("scan", ["--dir", project({}), "--ecosystem", "go"])).toBe(2);
    expect(errors[0]).toMatch(/^Go: unavailable — No go inventory found/);
    await expect(securityCli("scan", ["--dir", project({}), "--ecosystem", "ruby"])).rejects.toThrow("Supported ecosystems: php, npm, composer, maven, python, go, rust (scan only), auto.");
  });
  it("prints a read-only check like the others, plus what Ludion does not do", async () => {
    const result = await osv({ "django@3.2.0": ["GHSA-aaaa-bbbb-cccc"] }, { "GHSA-aaaa-bbbb-cccc": record("GHSA-aaaa-bbbb-cccc") }).scanReadOnly(pypi([django, requests], ["Unpinned requirement: flask>=2\u001b[2J"]));
    expect(readOnlyText("PyPI", result)).toEqual([
      "PyPI: 2 package versions · 1 advisory matches · vulnerabilities_found",
      "  django@3.2.0 · GHSA-aaaa-bbbb-cccc · Example advisory [2J · OSV lists fixed: 3.2.13, 4.0.4",
      "  Incomplete: Unpinned requirement: flask>=2 [2J",
      "  Scope: pinned_requirements (requirements.txt)",
      "  Read-only: Ludion reports known advisories for this ecosystem but does not plan or apply updates.",
    ]);
  });
});
