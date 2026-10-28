// Public read-only availability check of v4's unreadable removed versions in historical sources.
// For each key: does the source hold the version's declared dependencies (what the tree resolution needs)?
import { readFileSync, writeFileSync } from "node:fs";
const d = JSON.parse(readFileSync("/d/diag-unknown.json", "utf8"));
const removed = Object.entries(d.keys).filter(([, k]) => k === "version removed (time kept)").map(([key]) => key);
const split = key => { const at = key.lastIndexOf("@"); return [key.slice(0, at), key.slice(at + 1)]; };
const enc = n => encodeURIComponent(n);
const get = async (url) => {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "ludion-research (read-only)" }, redirect: "follow" });
      if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 3000 * (i + 1))); continue; }
      return { status: r.status, body: r.ok ? await r.text() : "" };
    } catch (e) { await new Promise(s => setTimeout(s, 2000)); }
  }
  return { status: "error", body: "" };
};
const out = [];
for (const key of removed) {
  const [name, version] = split(key);
  const eco = await get(`https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/${enc(name)}/versions/${enc(version)}`);
  let ecoDeps = null, ecoMeta = false, ecoUser = null, ecoScripts = null, ecoAttest = null;
  if (eco.status === 200) {
    const j = JSON.parse(eco.body);
    ecoMeta = !!(j.metadata && Object.keys(j.metadata).length);
    ecoDeps = Array.isArray(j.dependencies) ? j.dependencies.filter(x => x.kind !== "Development").map(x => `${x.package_name}@${x.requirements}`) : null;
    ecoUser = j.metadata?._npmUser?.name ?? null;
    ecoScripts = j.metadata?.scripts ? Object.keys(j.metadata.scripts).filter(s => ["preinstall", "install", "postinstall"].includes(s)) : null;
    ecoAttest = j.metadata?.dist ? !!j.metadata.dist.attestations : null;
  }
  const jsd = await get(`https://cdn.jsdelivr.net/npm/${name}@${version}/package.json`);
  let jsdDeps = null;
  if (jsd.status === 200) { try { const p = JSON.parse(jsd.body); jsdDeps = p.version === version ? Object.keys({ ...p.dependencies, ...p.optionalDependencies, ...p.peerDependencies }).length : `version mismatch ${p.version}`; } catch { jsdDeps = "unparseable"; } }
  const dd = await get(`https://api.deps.dev/v3/systems/npm/packages/${enc(name)}/versions/${enc(version)}`);
  out.push({ key, ecosystems: { status: eco.status, metadata: ecoMeta, runtime_deps: ecoDeps === null ? null : ecoDeps.length, publisher: ecoUser, install_scripts: ecoScripts, attestations: ecoAttest }, jsdelivr: { status: jsd.status, deps: jsdDeps }, depsdev: { status: dd.status } });
  console.log(key, eco.status, ecoMeta, jsd.status, dd.status);
}
// The one package the registry does not serve, and the identity facts of the three unverified same-release checks.
const extra = {};
extra.package = { eco: (await get("https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/%40notamitgamer%2Fmojic")).status, jsd: (await get("https://data.jsdelivr.com/v1/packages/npm/@notamitgamer/mojic")).status };
for (const v of ["2.2.2", "2.2.3", "2.2.4"]) {
  const e = await get(`https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/%40mistralai%2Fmistralai/versions/${v}`);
  const j = e.status === 200 ? JSON.parse(e.body) : null;
  extra[`@mistralai/mistralai@${v}`] = { status: e.status, publisher: j?.metadata?._npmUser ?? null, attestations: j?.metadata?.dist ? !!j.metadata.dist.attestations : null, published: j?.published_at ?? null };
}
writeFileSync("/out/probe.json", JSON.stringify({ checked_at: new Date().toISOString(), removed: out, extra }, null, 1));
console.log(JSON.stringify(extra));
