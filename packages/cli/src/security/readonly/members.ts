/**
 * Workspace member directories given as literal paths (Cargo's [workspace] members, uv's [tool.uv.workspace] members),
 * deduplicated and at most 1,000. Nothing is expanded: a pattern, a non-empty exclude list, an entry that is not a
 * plain path inside the project, or more than 1,000 members makes `unchecked` true, and the caller says so in one
 * limitation. Exclude entries are never read: any exclude list is already a limitation. Linear in the input's length:
 * entries are checked with string code, and no regex here has a quantified run.
 */
export function literalMembers(members: unknown, exclude: unknown): { dirs: string[]; unchecked: boolean } {
  let unchecked = (members !== undefined && !Array.isArray(members)) || (exclude !== undefined && (!Array.isArray(exclude) || exclude.length > 0));
  const dirs = new Set<string>();
  for (const member of Array.isArray(members) ? members : []) {
    if (typeof member !== "string" || !member || member.length > 500 || /[*?[\]{}!\\]/.test(member) || member.startsWith("/") || member.split("/").includes("..")) { unchecked = true; continue; }
    let start = 0, end = member.length;
    while (end > 0 && member[end - 1] === "/") end--;
    while (member.startsWith("./", start) && start + 2 <= end) start += 2;
    const path = member.slice(start, end);
    if (!path || path === ".") continue;
    if (!dirs.has(path) && dirs.size >= 1000) { unchecked = true; break; }
    dirs.add(path);
  }
  return { dirs: [...dirs], unchecked };
}
