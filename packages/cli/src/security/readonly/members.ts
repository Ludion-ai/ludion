/**
 * Workspace member directories given as literal paths (Cargo's [workspace] members, uv's [tool.uv.workspace] members),
 * deduplicated and at most 1,000. Nothing is expanded: a pattern, an exclude list, an entry that is not a plain path
 * inside the project, or more than 1,000 members makes `unchecked` true, and the caller says so in one limitation.
 * Linear in the number of entries, whatever their count.
 */
export function literalMembers(members: unknown, exclude: unknown): { dirs: string[]; unchecked: boolean } {
  let unchecked = (members !== undefined && !Array.isArray(members)) || (exclude !== undefined && (!Array.isArray(exclude) || exclude.length > 0));
  const excluded = new Set(Array.isArray(exclude) ? exclude.filter((e): e is string => typeof e === "string").map(e => e.replace(/\/+$/, "")) : []);
  const dirs = new Set<string>();
  for (const member of Array.isArray(members) ? members : []) {
    if (typeof member !== "string" || !member || member.length > 500 || /[*?[\]{}!\\]/.test(member) || member.startsWith("/") || member.split("/").includes("..")) { unchecked = true; continue; }
    const path = member.replace(/\/+$/, "").replace(/^(?:\.\/)+/, "");
    if (!path || path === "." || excluded.has(path)) continue;
    if (!dirs.has(path) && dirs.size >= 1000) { unchecked = true; break; }
    dirs.add(path);
  }
  return { dirs: [...dirs], unchecked };
}
