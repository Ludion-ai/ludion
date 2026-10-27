// Build-time data for every page. Runs in Node during `astro build` only; never shipped to the browser.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Config {
  org: string;
  repo: string;
  site: string;
}

export interface SiteData {
  config: Config;
  /** When this build ran. build.json carries it so the deploy check can tell the new version is live. */
  builtAt: string;
}

function load(): SiteData {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const config = JSON.parse(readFileSync(join(root, "ludion.config.json"), "utf8")) as Config;
  return { config, builtAt: new Date().toISOString() };
}

let cached: SiteData | undefined;
/** Loaded once per build and shared by every page. */
export async function siteData(): Promise<SiteData> {
  return (cached ??= load());
}
