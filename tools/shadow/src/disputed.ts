// The shadow's malicious-version categories (docs/decisions/2026-10-29-shadow-counting.md, section 6). A MAL-named
// version is checked against backtest v5's disputed standard (docs/bench/2026-10-28-backtest-v5/definitions.md,
// section 3), with one addition: where the recorder hashed V's files, they must equal the archives'. A disputed version
// is then a record-omission candidate or a false-report candidate, by the run of identical code back to O.
// Network, read-only and cached (archives-v5.ts): registry.npmjs.org, data.jsdelivr.com, cdn.jsdelivr.net,
// packages.ecosyste.ms, archive.softwareheritage.org, and OSV's query API by package name. Only package names and
// versions leave the machine. Tarballs are hashed in memory, never extracted to disk or run.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { registryTarball } from "../../../packages/cli/src/security/judge.ts";
import { Archive, codeDifferences, ecosystems, jsdelivrFile, jsdelivrList, names, registryTarFiles, registryVersions, scriptsFromFiles, swhFiles, swhLocate, swhMetadata, type EcoRecord, type FileList, type RegistryDist, type TarListing } from "../../backtest/src/archives-v5.ts";
import { allVersions, type Store } from "./replay.ts";

type Rec = Record<string, any>;
export type Category = "confirmed" | "record_omission" | "false_report" | "not_checked";
/** What the check reads. The network implementation is networkSources; tests give fakes. */
export type Sources = {
  /** Every OSV record naming the package (MAL- and others), or "unreadable". */
  osvRecords(name: string): Promise<Rec[] | "unreadable">;
  /** The registry's listed versions today: install scripts and dist fields. */
  registry(name: string): Promise<RegistryDist | null>;
  registryTar(name: string, version: string, integrity: string | null): Promise<TarListing>;
  jsdelivrList(name: string, version: string): Promise<FileList | null | "unreadable">;
  jsdelivrFile(name: string, version: string, path: string): Promise<Buffer | null>;
  ecosystems(name: string, version: string): Promise<EcoRecord | "unreadable">;
  swh(name: string, version: string, published: string): Promise<{ held: true; visit: string; root: string; files: FileList; dist: any | null; artifacts: any[] } | { held: false; why: string } | "unreadable">;
};

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const hexToSri = (algo: string, hex: string) => `${algo}-${Buffer.from(hex, "hex").toString("base64")}`;
const normalUrl = (u: string) => { try { return decodeURIComponent(u).replace(/^http:/, "https:"); } catch { return u; } };
const parse = (text: string | null) => { try { return text === null ? null : JSON.parse(text); } catch { return null; } };
type Copy = { source: string; shasum: string | null; integrity: string | null; unpackedSize: number | null };
export type Dispute = { step: string; disputed: boolean; prev_d: string | null; evidence?: Record<string, unknown> };

/** One version's files and root package.json: the registry's tarball when it lists the version, else jsDelivr's. */
async function filesOf(src: Sources, reg: RegistryDist, name: string, version: string): Promise<{ files: FileList; pkg: unknown; scripts: string[] } | string> {
  if (reg[version]) {
    const tar = await src.registryTar(name, version, reg[version]!.integrity);
    if (!tar.ok) return `${version}: tarball: ${tar.reason}`;
    return { files: new Map(tar.files.map(([p, sha, size]) => [p, { sha256: sha, size }])), pkg: parse(tar.packageJson), scripts: reg[version]!.scripts };
  }
  const list = await src.jsdelivrList(name, version);
  if (list === "unreadable" || !list) return `${version}: not listed by the registry, and jsDelivr ${list === "unreadable" ? "unreadable" : "does not hold it"}`;
  const bytes = await src.jsdelivrFile(name, version, "package.json");
  if (!bytes || sha256(bytes) !== list.get("package.json")?.sha256) return `${version}: jsDelivr's package.json does not match its list`;
  const pkg = parse(bytes.toString("utf8"));
  return { files: list, pkg, scripts: scriptsFromFiles(pkg, list.has("binding.gyp")) };
}

/** The latest-published version lower by semver and published before `version`, whether or not a record names it. */
export function predecessorIn(time: Map<string, string>, version: string): string | null {
  const at = Date.parse(time.get(version) ?? "");
  if (!semver.valid(version) || !Number.isFinite(at)) return null;
  return [...time].filter(([v, t]) => semver.valid(v) && semver.lt(v, version) && Date.parse(t) < at).sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))[0]?.[0] ?? null;
}

/** v5's disputed check (section 3), in its order, with the recorder's own file list as the one addition. */
export async function dispute(input: { name: string; version: string; published: string; time: Map<string, string>; records: Rec[]; captured: { shasum: string | null; integrity: string | null; unpacked_size: number | null; files: [string, number, string][] | null } | null; sources: Sources }): Promise<Dispute & { reg?: RegistryDist; list?: FileList; pkg?: unknown }> {
  const { name, version, time, records, captured, sources: src } = input;
  const at = Date.parse(input.published);
  const earlier = [...time].filter(([v, t]) => semver.valid(v) && Date.parse(t) < at).sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])).map(([v]) => v);
  const prevD = earlier.find(v => !records.some(rec => names(rec, name, v))) ?? null;
  const no = (step: string, evidence?: Record<string, unknown>): Dispute => ({ step, disputed: false, prev_d: prevD, ...(evidence ? { evidence } : {}) });
  if (!prevD) return no("no preceding legitimate version");
  const reg = await src.registry(name);
  if (!reg) return no("registry unreadable");
  if (!reg[prevD]) return no("prev_d not listed by the registry");
  const list = await src.jsdelivrList(name, version);
  if (list === "unreadable") return no("jsDelivr unreadable");
  if (!list) return no("jsDelivr does not hold V");
  const tar = await src.registryTar(name, prevD, reg[prevD]!.integrity);
  if (!tar.ok) return no(`prev_d tarball: ${tar.reason}`);
  const prevFiles: FileList = new Map(tar.files.map(([path, sha, size]) => [path, { sha256: sha, size }]));
  const vPkgBytes = await src.jsdelivrFile(name, version, "package.json");
  if (!vPkgBytes || sha256(vPkgBytes) !== list.get("package.json")?.sha256) return no("V's package.json from jsDelivr does not match its list");
  const pkg = parse(vPkgBytes.toString("utf8"));
  const differences = codeDifferences(list, pkg, prevFiles, parse(tar.packageJson));
  if (differences.length) return no("code differs from prev_d (jsDelivr's files)", { differences: differences.slice(0, 20), count: differences.length });
  // The addition (section 6): the recorder's own hashes of V's registry tarball must equal the archive's.
  if (captured?.files) {
    const mine = new Map(captured.files.map(([p, size, sha]) => [p, { sha256: sha, size }]));
    const paths = [...new Set([...mine.keys(), ...list.keys()])].filter(p => mine.get(p)?.sha256 !== list.get(p)?.sha256);
    if (paths.length) return no("the recorder's file list differs from jsDelivr's", { paths: paths.slice(0, 20), count: paths.length });
  }
  const copies: Copy[] = [];
  if (reg[version]) copies.push({ source: "registry", shasum: reg[version]!.shasum, integrity: reg[version]!.integrity, unpackedSize: reg[version]!.unpackedSize });
  if (captured) copies.push({ source: "recorder", shasum: captured.shasum, integrity: captured.integrity, unpackedSize: captured.unpacked_size });
  const eco = await src.ecosystems(name, version);
  if (eco !== "unreadable" && eco.held) copies.push({ source: "ecosyste.ms", shasum: eco.shasum, integrity: eco.integrity, unpackedSize: eco.unpackedSize });
  const jsTotal = [...list.values()].reduce((s, f) => s + f.size, 0);
  const agree = () => (["shasum", "integrity", "unpackedSize"] as const).every(k => new Set(copies.map(c => c[k]).filter(x => x !== null)).size <= 1);
  if (!agree()) return no("copies of the registry's version document disagree", { copies });
  if (copies.some(c => c.unpackedSize !== null && c.unpackedSize !== jsTotal)) return no("unpackedSize differs from jsDelivr's files", { copies, jsdelivr_total: jsTotal });
  const swh = await src.swh(name, version, input.published);
  if (swh === "unreadable") return no("Software Heritage unreadable");
  if (!swh.held) return no("Software Heritage does not hold V", { why: swh.why });
  const differ = [...new Set([...swh.files.keys(), ...list.keys()])].filter(p => swh.files.get(p)?.sha256 !== list.get(p)?.sha256);
  if (differ.length) return no("the two archives differ", { paths: differ.slice(0, 20), count: differ.length });
  if (swh.dist) copies.push({ source: "software-heritage", shasum: typeof swh.dist.shasum === "string" ? swh.dist.shasum : null, integrity: typeof swh.dist.integrity === "string" ? swh.dist.integrity : null, unpackedSize: typeof swh.dist.unpackedSize === "number" ? swh.dist.unpackedSize : null });
  if (!agree()) return no("copies of the registry's version document disagree", { copies });
  if (copies.some(c => c.unpackedSize !== null && c.unpackedSize !== jsTotal)) return no("unpackedSize differs from jsDelivr's files", { copies, jsdelivr_total: jsTotal });
  const shasum = copies.find(c => c.shasum)?.shasum ?? null, integrity = copies.find(c => c.integrity)?.integrity ?? null;
  if (!shasum && !integrity) return no("no copy gives the registry's hash", { copies });
  const tarball = normalUrl(registryTarball(name, version));
  const tied = swh.artifacts.find(a => typeof a?.url === "string" && normalUrl(a.url) === tarball && ((shasum && a.checksums?.sha1 === shasum) || (integrity && typeof a.checksums?.sha512 === "string" && hexToSri("sha512", a.checksums.sha512) === integrity)));
  if (!tied) return no("Software Heritage's artifact is not tied to the registry's hash", { copies });
  return { step: "disputed", disputed: true, prev_d: prevD, evidence: { copies, artifact: tied, swh_visit: swh.visit, swh_root: swh.root, files: list.size }, reg, list, pkg };
}

/**
 * Section 6: confirmed, or (when disputed) a record-omission or false-report candidate. O is the first version of the
 * run of code identical to V's, found by stepping from V to each predecessor while the code is equal. A version that
 * cannot be read ends the run there, which keeps O later (the stricter side). V is a record-omission candidate when O
 * was published after the earliest-published other version a MAL- record names, or O declares an install script its
 * predecessor does not (a first version: any install script; a predecessor that cannot be read: counted as added).
 */
export async function categorize(input: { name: string; version: string; published: string | null; store: Store; records: Rec[]; sources: Sources }): Promise<{ category: Category; evidence: unknown }> {
  const { name, version, store, sources: src } = input;
  const time = allVersions(store, name);
  if (!input.published) return { category: "confirmed", evidence: { step: "no stored publish time: the disputed check cannot place prev_d" } };
  const osv = await src.osvRecords(name);
  if (osv === "unreadable") return { category: "confirmed", evidence: { step: "OSV's records for the package unreadable" } };
  // Every MAL- record naming the package: OSV's answer today, and the recorder's copies (latest per id). Not withdrawn.
  const byId = new Map<string, Rec>();
  for (const r of [...osv, ...input.records]) if (typeof r?.id === "string" && r.id.startsWith("MAL-") && (r.affected ?? []).some((a: any) => a?.package?.ecosystem === "npm" && a.package.name === name)) byId.set(r.id, r);
  const records = [...byId.values()].filter(r => !r.withdrawn);
  const cap = store.versions.get(`${name}@${version}`)?.at(-1);
  const d = await dispute({ name, version, published: input.published, time, records, captured: cap ? { shasum: cap.shasum, integrity: cap.integrity, unpacked_size: cap.unpacked_size, files: cap.files } : null, sources: src });
  const { reg, list, pkg, ...shown } = d;
  if (!d.disputed) return { category: "confirmed", evidence: shown };
  // The run of identical code, back to O.
  let cur = { version, files: list!, pkg, scripts: scriptsFromFiles(pkg, list!.has("binding.gyp")) };
  const run: string[] = [version];
  let before: { version: string; scripts: string[] } | null = null, ended = "no earlier version";
  for (let step = 0; step < 1000; step++) {
    const p = predecessorIn(time, cur.version);
    if (!p) break;
    const f = await filesOf(src, reg!, name, p);
    if (typeof f === "string") { ended = `unreadable: ${f}`; break; }
    if (codeDifferences(cur.files, cur.pkg, f.files, f.pkg).length) { before = { version: p, scripts: f.scripts }; ended = "code differs"; break; }
    cur = { version: p, ...f };
    run.push(p);
  }
  const o = cur.version, oAt = Date.parse(time.get(o) ?? "");
  const named = [...time.keys()].filter(v => v !== version && records.some(r => names(r, name, v))).sort((a, b) => Date.parse(time.get(a)!) - Date.parse(time.get(b)!));
  const afterNamed = named.length > 0 && oAt > Date.parse(time.get(named[0]!)!);
  // A predecessor that could not be read cannot show the script was there before: counted as added (the stricter side).
  const addsScript = ended.startsWith("unreadable") || cur.scripts.some(s => !(before?.scripts ?? []).includes(s));
  return {
    category: afterNamed || addsScript ? "record_omission" : "false_report",
    evidence: { ...shown, o, run, run_ended: ended, o_predecessor: before?.version ?? null, earliest_other_named: named[0] ?? null, o_after_earliest_named: afterNamed, o_scripts: cur.scripts, o_predecessor_scripts: before?.scripts ?? null, o_adds_install_script: addsScript },
  };
}

/** The network sources, cached under `cacheDir` (archives-v5.ts's cache layout, plus OSV answers). */
export function networkSources(cacheDir: string): Sources {
  const archive = new Archive(cacheDir);
  return {
    async osvRecords(name) {
      const file = join(cacheDir, "osv-query", `${encodeURIComponent(name)}.json`);
      if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
      const out: Rec[] = [];
      let token: string | undefined;
      for (let page = 0; page < 50; page++) {
        let body: any = null;
        for (let attempt = 0; attempt < 4 && !body; attempt++) {
          const res = await fetch("https://api.osv.dev/v1/query", { method: "POST", redirect: "error", signal: AbortSignal.timeout(60_000), headers: { "content-type": "application/json", "user-agent": "Ludion-Shadow-Replay" }, body: JSON.stringify({ package: { ecosystem: "npm", name }, ...(token ? { page_token: token } : {}) }) }).catch(() => null);
          if (res?.ok) body = await res.json().catch(() => null);
          else await new Promise(r => setTimeout(r, 3_000 * (attempt + 1)));
        }
        if (!body) return "unreadable";
        out.push(...(Array.isArray(body.vulns) ? body.vulns : []));
        token = typeof body.next_page_token === "string" ? body.next_page_token : undefined;
        if (!token) break;
      }
      if (token) return "unreadable";
      mkdirSync(join(cacheDir, "osv-query"), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(out)); renameSync(`${file}.tmp`, file);
      return out;
    },
    registry: name => registryVersions(archive, cacheDir, name),
    registryTar: (name, version, integrity) => registryTarFiles(archive, cacheDir, name, version, integrity),
    jsdelivrList: (name, version) => jsdelivrList(archive, name, version),
    jsdelivrFile: (name, version, path) => jsdelivrFile(archive, name, version, path),
    ecosystems: (name, version) => ecosystems(archive, name, version),
    async swh(name, version, published) {
      const hold = await swhLocate(archive, name, version, published);
      if (hold === "unreadable" || !hold.held) return hold;
      const files = await swhFiles(archive, hold.packageRoot);
      if (files === "unreadable") return "unreadable";
      const meta = await swhMetadata(archive, hold.root);
      if (meta === "unreadable") return "unreadable";
      return { held: true, visit: hold.visit, root: hold.root, files, dist: meta.dist, artifacts: meta.artifacts };
    },
  };
}
