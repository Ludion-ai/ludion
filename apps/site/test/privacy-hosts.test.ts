// "What leaves your machine" on the setup page names every host the CLI's code reaches over HTTPS. A new https:// host in
// packages/cli/src fails here until the English and Japanese copy name it, or it is added below with the reason it is
// not a request.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { en } from "../src/strings/en.ts";
import { ja } from "../src/strings/ja.ts";

const src = fileURLToPath(new URL("../../../packages/cli/src/", import.meta.url));

/** Hosts written after https:// in packages/cli/src, with the files they are in. */
function cliHosts(): Map<string, string[]> {
  const hosts = new Map<string, string[]>();
  for (const file of readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts")).sort()) {
    for (const [, host] of readFileSync(join(src, file), "utf8").matchAll(/https:\/\/([A-Za-z0-9.-]+)/g)) {
      hosts.set(host!, [...(hosts.get(host!) ?? []), file]);
    }
  }
  return hosts;
}

/** Hosts in the code that Ludion never sends a request to, each with the reason. */
const NOT_REQUESTED: Record<string, string> = {
  "osv.dev": "the source label in a receipt; requests go to api.osv.dev",
  "slsa.dev": "the provenance predicate type an npm attestation is matched against",
  "github.com": "crates.io's registry id as Cargo.lock names it (Composer archives from github.com are named on the page anyway)",
  "index.crates.io": "crates.io's sparse registry id as Cargo.lock names it; crates are only looked up in OSV",
  "user": "a comment's example of a source URL that carries credentials",
};

describe("What leaves your machine", () => {
  const hosts = cliHosts();
  it("finds the hosts the CLI requests", () => {
    for (const host of ["api.osv.dev", "registry.npmjs.org", "repo.packagist.org", "www.cisa.gov", "epss.empiricalsecurity.com"]) expect(hosts.has(host), host).toBe(true);
  });
  for (const [lang, strings] of [["en", en], ["ja", ja]] as const) {
    it(`names every https:// host of packages/cli/src in the ${lang} copy`, () => {
      const text = Object.values(strings.start.privacy).join("\n");
      const missing = [...hosts].filter(([host]) => !(host in NOT_REQUESTED) && !new RegExp(`(?<![\\w.-])${host.replace(/\./g, "\\.")}(?![\\w-]|\\.[a-z])`).test(text));
      expect(missing.map(([host, files]) => `${host} (${files.join(", ")})`)).toEqual([]);
    });
  }
  it("keeps no reason for a host the code no longer has", () => {
    expect(Object.keys(NOT_REQUESTED).filter((host) => !hosts.has(host))).toEqual([]);
  });
});
