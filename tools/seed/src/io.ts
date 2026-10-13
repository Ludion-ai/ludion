// The pipeline's working files: JSON in one folder per run.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const read = <T>(dir: string, name: string): T => JSON.parse(readFileSync(join(dir, name), "utf8")) as T;
export const write = (dir: string, name: string, value: unknown): void => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n");

export interface RunInfo {
  package: string;
  range: string;
  since?: string;
  repo: string;
  versions: string[];
  missing: string[];
  collected_at: string;
}
