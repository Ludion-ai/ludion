// "What leaves your machine" on the setup page names every host the CLI's code reaches over HTTPS. A new https:// host in
// packages/cli/src, or a new host in the Composer archive policy, fails here until the English and Japanese copy name it,
// or it is added below with the reason it is not a request. Hosts the CLI is given at run time (the GitHub API and remote
// that `ludion deliver open` gets from the workflow) are not in the code; the copy names GitHub, checked separately.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { en } from "../src/strings/en.ts";
import { ja } from "../src/strings/ja.ts";

const src = fileURLToPath(new URL("../../../packages/cli/src/", import.meta.url));
const read = (file: string) => readFileSync(join(src, file), "utf8");

/** Hosts written after https:// in packages/cli/src, and the keys of the Composer archive policy, with their files. */
function cliHosts(): Map<string, string[]> {
  const hosts = new Map<string, string[]>();
  const add = (host: string, file: string) => hosts.set(host, [...(hosts.get(host) ?? []), file]);
  for (const file of readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts")).sort()) {
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

describe("What leaves your machine", () => {
  const hosts = cliHosts();
  it("finds the hosts the CLI requests", () => {
    for (const host of ["api.osv.dev", "registry.npmjs.org", "repo.packagist.org", "www.cisa.gov", "epss.empiricalsecurity.com", "codeload.github.com", "bitbucket.org"]) expect(hosts.has(host), host).toBe(true);
  });
  for (const [lang, strings] of [["en", en], ["ja", ja]] as const) {
    const text = Object.values(strings.start.privacy).join("\n");
    it(`names every host of packages/cli/src in the ${lang} copy`, () => {
      const missing = [...hosts].filter(([host]) => !(host in NOT_REQUESTED) && !new RegExp(`(?<![\\w.-])${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-]|\\.[a-z])`).test(text));
      expect(missing.map(([host, files]) => `${host} (${files.join(", ")})`)).toEqual([]);
    });
    it(`names GitHub, where deliver open pushes branches and opens PRs, in the ${lang} copy`, () => {
      expect(read("security/deliver.ts")).toMatch(/\/repos\/\$\{options\.repo\}\/pulls`/);
      expect(text).toMatch(/\bGitHub\b/);
    });
  }
  it("keeps no reason for a host the code no longer has", () => {
    expect(Object.keys(NOT_REQUESTED).filter((host) => !hosts.has(host))).toEqual([]);
  });
});
