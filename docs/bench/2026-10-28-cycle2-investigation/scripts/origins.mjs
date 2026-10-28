// For the 7 selected malicious versions: when did each version first appear in any source of its OSV record?
const rows = [
  ["MAL-2025-190866", "0.1.1"], ["MAL-2025-46974", "4.4.2"], ["MAL-2025-46972", "2.0.1"], ["MAL-2025-46977", "0.3.3"],
  ["MAL-2025-46975", "1.3.3"], ["MAL-2025-46978", "0.2.3"], ["MAL-2025-190643", "6.10.1"],
];
for (const [id, v] of rows) {
  const r = await (await fetch(`https://api.osv.dev/v1/vulns/${id}`)).json();
  const origins = r.database_specific?.["malicious-packages-origins"] ?? [];
  const naming = origins.filter((o) => (o.versions ?? []).includes(v));
  const first = naming.map((o) => o.modified_time).sort()[0];
  const firstImport = naming.map((o) => o.import_time).sort()[0];
  console.log(id, v, "published", r.published, "modified", r.modified, "| first source naming v: modified", first, "import", firstImport, "| sources", JSON.stringify(origins.map((o) => [o.source, o.versions, o.modified_time])));
}
