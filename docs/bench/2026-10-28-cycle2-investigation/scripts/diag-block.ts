
// --- Diagnostic (cycle 2, not committed): the unreadable keys behind each unknown version. Changes no outcome. ---
{
  const diagFile = process.env.DIAG_OUT;
  if (!diagFile) throw new Error("DIAG_OUT is needed.");
  const kindOf = async (key: string): Promise<string> => {
    if (key.includes(" -> ")) return "unparseable spec";
    if (key.includes("the same-release check is")) return "same-release check unverified";
    if (key.startsWith("tree larger than")) return "tree too large";
    const at = key.lastIndexOf("@");
    const name = key.slice(0, at), rest = key.slice(at + 1);
    const d = await doc(name);
    if (d === null) return "package not served";
    if (d === "error") return "package unreadable";
    if (semver.valid(rest)) return d.versions[rest] ? "version listed (other)" : d.time[rest] ? "version removed (time kept)" : "version unknown";
    return "range on a readable package (other)";
  };
  const perUrgency: Record<string, { versions: number; rows: { id: string; name: string; version: string; fixes: string[]; keys: string[] }[] }> = {};
  const allKeys = new Map<string, string>();
  for (const u of URGENCIES) {
    const list: { id: string; name: string; version: string; fixes: string[]; keys: string[] }[] = [];
    rows.forEach((r, i) => {
      if (out[i]!.with_exception.outcomes[u].conservative.primary !== "unknown") return;
      const p = Date.parse(r.published);
      const live = results.filter(x => x.fix.t > p - HORIZON && x.fix.name !== r.name && !x.with.stopped);
      const fixes = new Set<string>(), keys = new Set<string>();
      for (const s of ["a", "b"] as const) for (const x of live) {
        if (x.fix.t > p && x.with.newest + wait(r, u, s) * H < record(r, "conservative") && x.with.unknown) {
          fixes.add(fixId(x));
          for (const k of x.with.tree.unknown) keys.add(k);
        }
      }
      for (const k of keys) allKeys.set(k, "");
      list.push({ id: r.id, name: r.name, version: r.version, fixes: [...fixes].sort(), keys: [...keys].sort() });
    });
    perUrgency[u] = { versions: list.length, rows: list };
  }
  for (const k of allKeys.keys()) allKeys.set(k, await kindOf(k));
  const byKind: Record<string, number> = {};
  for (const k of allKeys.values()) byKind[k] = (byKind[k] ?? 0) + 1;
  writeFileSync(diagFile, `${JSON.stringify({ note: "Diagnostic of backtest v4's unknowns (cycle 2). Changes no outcome.", distinct_keys: allKeys.size, by_kind: byKind, keys: Object.fromEntries(allKeys), per_urgency: perUrgency }, null, 1)}\n`);
  console.error(`diag: ${allKeys.size} keys`, JSON.stringify(byKind));
}
