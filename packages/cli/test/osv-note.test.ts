// The scan note is in every receipt, before and after, and says where Ludion sends what. A new https:// host in
// packages/cli/src, or a new host in the Composer archive policy, fails here until the note names it, or it is added
// below with the reason it is not a request; a host the note names that the code no longer has fails too. The GitHub API
// and remote that `ludion deliver open` gets from the workflow are not in the code; the note names GitHub, checked apart.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OsvClient, SCAN_NOTE } from "../src/security/osv.ts";

const src = fileURLToPath(new URL("../src/", import.meta.url));
const read = (file: string) => readFileSync(join(src, file), "utf8");

/** Hosts written after https:// in packages/cli/src, and the keys of the Composer archive policy, with their files. */
function codeHosts(): Map<string, string[]> {
  const hosts = new Map<string, string[]>();
  const add = (host: string, file: string) => hosts.set(host, [...(hosts.get(host) ?? []), file]);
  for (const file of readdirSync(src, { recursive: true, encoding: "utf8" }).filter(f => f.endsWith(".ts")).sort()) {
    for (const [, host] of read(file).matchAll(/https:\/\/([A-Za-z0-9.-]+)/g)) add(host!, file);
  }
  const policy = /export function publicArchiveUrl[\s\S]*?const patterns[^{]*\{([\s\S]*?)\n\s*\};/.exec(read("security/acquisition.ts"));
  for (const [, host] of policy?.[1]!.matchAll(/"([a-z0-9.-]+)":/g) ?? []) add(host!, "security/acquisition.ts publicArchiveUrl");
  return hosts;
}

/** Hosts in the code that Ludion never sends a request to, each with the reason. */
const NOT_REQUESTED: Record<string, string> = {
  "osv.dev": "the source label in a receipt; requests go to api.osv.dev",
  "slsa.dev": "the provenance predicate type an npm attestation is matched against",
  "index.crates.io": "crates.io's sparse registry id as Cargo.lock names it; crates are only looked up in OSV",
  "user": "a comment's example of a source URL that carries credentials",
};

const escape = (host: string) => host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const names = (text: string, host: string) => new RegExp(`(?<![\\w.-])${escape(host)}(?![\\w-]|\\.[a-z])`).test(text);

describe("the scan note names every host Ludion sends a request to", () => {
  const hosts = codeHosts();
  it("is the note scan() puts in its result", async () => {
    const scan = await new OsvClient(async () => { throw new Error("no request expected"); }).scan({ ecosystem: "npm", files: [], scope: "locked_dependencies", packages: [], limitations: [] });
    expect(scan.note).toBe(SCAN_NOTE);
  });
  it("finds the hosts the CLI requests", () => {
    for (const host of ["api.osv.dev", "registry.npmjs.org", "packagist.org", "repo.packagist.org", "codeload.github.com", "bitbucket.org", "repo.maven.apache.org", "www.php.net", "auth.docker.io", "registry-1.docker.io", "www.cisa.gov", "epss.empiricalsecurity.com"]) expect(hosts.has(host), host).toBe(true);
  });
  it("names every host of packages/cli/src", () => {
    const missing = [...hosts].filter(([host]) => !(host in NOT_REQUESTED) && !names(SCAN_NOTE, host));
    expect(missing.map(([host, files]) => `${host} (${files.join(", ")})`)).toEqual([]);
  });
  it("names no host the code does not request", () => {
    const named = [...SCAN_NOTE.matchAll(/(?<![\w.-])(?:[a-z0-9-]+\.)+(?:dev|org|com|gov|net|io)(?![\w-])/g)].map(m => m[0]);
    expect(named.length).toBeGreaterThan(10);
    expect(named.filter(host => !hosts.has(host) || host in NOT_REQUESTED)).toEqual([]);
  });
  it("names GitHub, where deliver open pushes branches and opens PRs", () => {
    expect(read("security/deliver.ts")).toMatch(/\/repos\/\$\{options\.repo\}\/pulls`/);
    expect(SCAN_NOTE).toMatch(/`ludion deliver open` pushes each fix's commit to the project's own GitHub repository/);
  });
  it("keeps no reason for a host the code no longer has", () => {
    expect(Object.keys(NOT_REQUESTED).filter(host => !hosts.has(host))).toEqual([]);
  });
});
