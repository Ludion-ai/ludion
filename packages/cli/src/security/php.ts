import { createHash } from "node:crypto";

export const RELEASES_URL = "https://www.php.net/releases/index.php";
export const hash = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");
export type PhpImage = { reference: string; version: string; branch: string; flavor: string; start: number; end: number };
export type Release = { version: string; date: string; security: boolean };
export type Scan = {
  schema: 1;
  checked_at: string;
  status: "update_available" | "no_newer_security_release";
  scope: "dockerfile_base_image";
  current: PhpImage;
  candidate: { version: string; reference: string } | null;
  security_releases: Release[];
  source: string;
  note: string;
};

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
export function compare(a: string, b: string): number {
  const av = VERSION.exec(a), bv = VERSION.exec(b);
  if (!av || !bv) throw new Error("Expected exact stable PHP versions.");
  for (let i = 1; i <= 3; i++) {
    const delta = Number(av[i]) - Number(bv[i]);
    if (delta) return delta;
  }
  return 0;
}

/** Deliberately narrow: one stage, an exact version, an official PHP image. Never guess ARGs or floating tags. */
export function phpImage(dockerfile: string): PhpImage {
  if (dockerfile.length > 64 * 1024) throw new Error("Dockerfile exceeds 64 KiB.");
  if (/^\s*#\s*(?:syntax|escape)\s*=/im.test(dockerfile) || /\\\r?\n/.test(dockerfile)) {
    throw new Error("Dockerfile frontend directives and continuations are not supported in this preview.");
  }
  const stages = [...dockerfile.matchAll(/^\s*FROM\s+([^\r\n]+)$/gim)];
  if (stages.length !== 1) throw new Error("Expected one FROM stage. Multi-stage and missing-base projects need manual review.");
  const stage = stages[0]!;
  const ref = /^(?:(?:docker\.io\/)?library\/)?php:(\d+\.\d+\.\d+)(-?(?:cli|fpm|apache)(?:-[a-z0-9][a-z0-9.-]*)?)(?:@sha256:[a-f0-9]{64})?$/;
  const from = stage[1]!.trim();
  const match = ref.exec(from);
  if (!match) throw new Error("Use one official PHP image with an exact stable version and flavor, e.g. php:8.4.26-cli-alpine. ARGs, aliases and floating tags are not supported.");
  if (!match[2]!.startsWith("-")) throw new Error("PHP image flavor must follow a hyphen.");
  // Block hidden downloads/frontends in an otherwise offline build. No remote ADD, external COPY or network overrides.
  if (/^\s*ADD\s/im.test(dockerfile) || /^\s*COPY\s+.*--from[=\s]/im.test(dockerfile) || /^\s*RUN\s+.*--(?:network|mount)[=\s]/im.test(dockerfile)) {
    throw new Error("ADD, external COPY and RUN network/mount overrides are not supported by the offline validator.");
  }
  const start = stage.index! + stage[0].indexOf(stage[1]!);
  return { reference: from, version: match[1]!, branch: match[1]!.split(".").slice(0, 2).join("."), flavor: match[2]!, start, end: start + stage[1]!.length };
}

export function parseReleases(input: unknown, branch: string): Release[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid official PHP release response.");
  const releases: Release[] = [];
  for (const [version, value] of Object.entries(input)) {
    if (!VERSION.test(version) || !version.startsWith(`${branch}.`)) continue;
    if (!value || typeof value !== "object") throw new Error("Invalid PHP release entry.");
    const item = value as { date?: unknown; tags?: unknown };
    if (typeof item.date !== "string" || !Number.isFinite(Date.parse(item.date)) || !Array.isArray(item.tags) || !item.tags.every(t => typeof t === "string")) {
      throw new Error("Incomplete PHP release metadata. No update decision was made.");
    }
    releases.push({ version, date: item.date, security: item.tags.includes("security") });
  }
  if (!releases.length) throw new Error(`No official releases found for PHP ${branch}. Do not interpret this as safe or supported.`);
  return releases.sort((a, b) => compare(b.version, a.version));
}

export async function scanPhp(dockerfile: string, fetchFn: typeof fetch = fetch): Promise<Scan> {
  const current = phpImage(dockerfile);
  const url = `${RELEASES_URL}?json&version=${current.branch}&max=100`;
  const res = await fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "Ludion-Security-Preview", "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Official PHP release lookup failed (HTTP ${res.status}). No update decision was made.`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Empty PHP release response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw new Error("PHP release response exceeds 1 MiB.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const releases = parseReleases(JSON.parse(Buffer.concat(chunks).toString("utf8")), current.branch);
  const fixes = releases.filter(r => r.security && compare(r.version, current.version) > 0);
  const latest = releases[0]!;
  const candidate = fixes.length ? { version: latest.version, reference: `php:${latest.version}${current.flavor}` } : null;
  return {
    schema: 1, checked_at: new Date().toISOString(), status: candidate ? "update_available" : "no_newer_security_release",
    scope: "dockerfile_base_image", current, candidate, security_releases: fixes, source: url,
    note: "Checks official PHP security-release metadata against the Dockerfile, not live deployment inventory or every CVE. No match is not a security guarantee. No major/minor upgrades, EOL certification, or automatic production deployment.",
  };
}

export function replaceImage(text: string, image: PhpImage, reference: string): string {
  if (text.slice(image.start, image.end).trim() !== image.reference) throw new Error("Dockerfile changed; scan again.");
  return text.slice(0, image.start) + reference + text.slice(image.end);
}
