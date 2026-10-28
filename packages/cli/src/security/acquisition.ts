import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { jsonFile, parsePom } from "./inventory.ts";
import { hash } from "./php.ts";

export const MAVEN_SETTINGS = '<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"><mirrors><mirror><id>ludion-central</id><mirrorOf>*</mirrorOf><url>https://repo.maven.apache.org/maven2</url></mirror></mirrors></settings>';

/**
 * Maven also reads plugin parameters from project properties, so a property named like one of the dependency plugin's
 * parameters (excludes, scope, ...) could filter the resolved tree and hide a vulnerable package.
 */
const PLUGIN_PARAMETERS = new Set(["includes", "excludes", "scope", "verbose", "tokens", "outputType", "outputFile", "outputEncoding", "outputScope", "appendOutput", "skip", "silent", "outputDirectory", "excludeTransitive", "includeScope", "excludeScope", "includeGroupIds", "excludeGroupIds", "includeArtifactIds", "excludeArtifactIds", "includeTypes", "excludeTypes", "includeClassifiers", "excludeClassifiers"]);

/**
 * Online Maven sees dependency declarations only. The original build/plugin/report model is used only offline.
 * Properties are kept only when the dependency model refers to them, directly or through other kept properties.
 */
export function acquisitionPom(original: string): string {
  const parsed = parsePom(original);
  const document = new DOMParser().parseFromString('<project xmlns="http://maven.apache.org/POM/4.0.0"/>', 'application/xml');
  const allowed = new Set(["modelVersion", "groupId", "artifactId", "version", "packaging", "dependencies", "dependencyManagement"]);
  const elements = Array.from(parsed.project.childNodes).filter(node => node.nodeType === 1);
  const kept = elements.filter(node => allowed.has((node as any).localName));
  const properties = elements.find(node => (node as any).localName === "properties");
  const values = new Map<string, string>();
  for (const node of Array.from(properties?.childNodes ?? [])) if (node.nodeType === 1) values.set((node as any).localName, node.textContent ?? "");
  const used = new Set<string>(), pending = kept.map(node => node.textContent ?? "");
  while (pending.length) {
    for (const [, name] of pending.pop()!.matchAll(/\$\{([^}]+)\}/g)) {
      if (!name || used.has(name) || !values.has(name)) continue;
      if (PLUGIN_PARAMETERS.has(name) || name.startsWith("mdep.")) throw new Error(`Maven property ${name} is also a dependency-plugin parameter; it needs review.`);
      used.add(name); pending.push(values.get(name)!);
    }
  }
  const root = document.documentElement!;
  for (const node of kept) root.appendChild(document.importNode(node, true));
  if (used.size) {
    const element = document.createElementNS(root.namespaceURI, "properties");
    for (const node of Array.from(properties!.childNodes)) if (node.nodeType === 1 && used.has((node as any).localName)) element.appendChild(document.importNode(node, true));
    root.appendChild(element);
  }
  return new XMLSerializer().serializeToString(document);
}

/** Public, commit-addressed archives only. Every redirect is checked again before making the next request. */
export function publicArchiveUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hash) throw new Error("Archive must use credential-free public HTTPS.");
  const sha = "[a-fA-F0-9]{40,64}";
  const patterns: Record<string, RegExp> = {
    "api.github.com": new RegExp(`^/repos/[^/]+/[^/]+/(?:zipball|tarball)/${sha}/?$`),
    "codeload.github.com": new RegExp(`^/[^/]+/[^/]+/(?:legacy\\.zip|zip|legacy\\.tar\\.gz|tar\\.gz)/${sha}/?$`),
    "github.com": new RegExp(`^/[^/]+/[^/]+/archive/${sha}\\.(?:zip|tar\\.gz)$`),
    "bitbucket.org": new RegExp(`^/[^/]+/[^/]+/get/${sha}\\.zip$`),
  };
  if (!patterns[url.hostname]?.test(url.pathname) || url.search) throw new Error("Archive origin/path is outside the public pinned-archive policy.");
  return url;
}

export type ArchiveEvidence = { url: string; final_url: string; sha256: string; bytes: number };
export async function localComposerLock(exported: string, destination: string, cache: string, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<ArchiveEvidence[]> {
  const active = () => { if (signal?.aborted) throw new Error("Archive acquisition cancelled."); };
  active();
  mkdirSync(destination, { recursive: true }); mkdirSync(cache, { recursive: true });
  const lock = jsonFile(exported, "composer.lock"), evidence: ArchiveEvidence[] = [];
  let total = 0;
  for (const pkg of [...lock.packages, ...(lock["packages-dev"] ?? [])]) {
    active();
    if (pkg.dist?.type !== "zip" || typeof pkg.dist.url !== "string") throw new Error("Composer adapter currently requires pinned public ZIP distributions.");
    const original = publicArchiveUrl(pkg.dist.url).href, key = hash(original), cached = join(cache, key);
    let bytes: Buffer, final = original;
    if (existsSync(cached)) {
      bytes = readFileSync(cached);
      const metadata = JSON.parse(readFileSync(`${cached}.json`, "utf8"));
      final = publicArchiveUrl(metadata.final_url).href;
      if (metadata.sha256 !== hash(bytes)) throw new Error("Archive cache checksum mismatch.");
    }
    else {
      for (let hop = 0; ; hop++) {
        if (hop > 5) throw new Error("Too many archive redirects.");
        active();
        const url = publicArchiveUrl(final);
        const controller = new AbortController(), stop = () => controller.abort();
        const timeout = setTimeout(stop, 60_000);
        signal?.addEventListener("abort", stop, { once: true });
        try {
        const response = await fetchFn(url, { redirect: "manual", signal: controller.signal, headers: { "user-agent": "Ludion-Security-Preview", "accept": "application/zip" } });
        active();
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location"); await response.body?.cancel();
          if (!location) throw new Error("Archive redirect has no location.");
          final = publicArchiveUrl(new URL(location, url).href).href; continue;
        }
        if (!response.ok || !response.body) throw new Error(`Archive download failed (HTTP ${response.status}).`);
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) { const result = await reader.read(); if (result.done) break; size += result.value.length; if (size > 32 * 1024 * 1024) throw new Error("Archive exceeds 32 MiB."); chunks.push(result.value); }
        } finally { await reader.cancel().catch(() => {}); }
        bytes = Buffer.concat(chunks);
        active();
        writeFileSync(cached, bytes, { flag: "wx", mode: 0o600 });
        writeFileSync(`${cached}.json`, JSON.stringify({ final_url: final, sha256: hash(bytes) }), { flag: "wx", mode: 0o600 });
        break;
        } finally { clearTimeout(timeout); signal?.removeEventListener("abort", stop); }
      }
    }
    active();
    total += bytes.length;
    if (total > 100 * 1024 * 1024) throw new Error("Composer archive set exceeds 100 MiB.");
    if (pkg.dist.shasum && (!/^[a-f0-9]{40}$/i.test(pkg.dist.shasum) || createHash("sha1").update(bytes).digest("hex") !== pkg.dist.shasum.toLowerCase())) throw new Error("Composer archive checksum mismatch.");
    const digest = hash(bytes), name = `${digest}.zip`;
    if (!existsSync(join(destination, name))) writeFileSync(join(destination, name), bytes, { flag: "wx", mode: 0o644 });
    evidence.push({ url: original, final_url: final, sha256: digest, bytes: bytes.length });
    pkg.dist = { ...pkg.dist, url: `file:///archives/${name}`, shasum: createHash("sha1").update(bytes).digest("hex") };
    delete pkg.source;
  }
  writeFileSync(join(destination, "composer.lock"), `${JSON.stringify(lock, null, 2)}\n`);
  return evidence;
}
