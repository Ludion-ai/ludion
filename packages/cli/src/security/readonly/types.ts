/** OSV ecosystem names for inventories Ludion reads but does not patch. */
export type ReadOnlyEcosystem = "PyPI" | "Go" | "crates.io";
export type ReadOnlyPackage = { name: string; version: string; direct: boolean };
/** What one manifest reader saw. Anything it could not read exactly is listed in limitations, never dropped silently. */
export type ReadOnlyInventory = { ecosystem: ReadOnlyEcosystem; files: string[]; scope: string; packages: ReadOnlyPackage[]; limitations: string[] };
