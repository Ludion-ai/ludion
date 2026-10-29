import { readGo } from "./go.ts";
import { readPython } from "./python.ts";
import { readRust } from "./rust.ts";
import type { ReadOnlyEcosystem, ReadOnlyInventory } from "./types.ts";

/** Project-root file names that make a read-only reader applicable. */
export const PYTHON_FILES = ["requirements.txt", "pyproject.toml", "poetry.lock", "uv.lock", "Pipfile.lock", "Pipfile", "setup.py", "setup.cfg"];
export const GO_FILES = ["go.mod"];
export const RUST_FILES = ["Cargo.lock", "Cargo.toml"];

/** `ludion scan --ecosystem` names for the read-only ecosystems. Their ecosystems have no update policy. */
export const READONLY_CLI_NAMES = {
  python: { ecosystem: "PyPI", files: PYTHON_FILES },
  go: { ecosystem: "Go", files: GO_FILES },
  rust: { ecosystem: "crates.io", files: RUST_FILES },
} as const satisfies Record<string, { ecosystem: ReadOnlyEcosystem; files: string[] }>;
export type ReadOnlyCliName = keyof typeof READONLY_CLI_NAMES;
export const isReadOnlyCliName = (name: string | undefined): name is ReadOnlyCliName => name !== undefined && Object.hasOwn(READONLY_CLI_NAMES, name);
/** Why init, patch, watch and a saved policy refuse a read-only ecosystem. */
export const readOnlyRefusal = (name: string) => `${name} is read-only: ludion scan reports its known advisories, but Ludion has no update policy for it, so init, patch and watch do not accept it.`;

/**
 * A reader runs when one of its files exists at the project root. It returns null only when none of them exists. Every
 * present file from `files` is either read (and named in the inventory's `files`) or named in a limitation; scan adds a
 * limitation for one that is neither. A reader that reads a lock also reads the manifest beside it, to check that the
 * lock is that manifest's.
 */
export type ReadOnlyReader = { ecosystem: ReadOnlyEcosystem; files: string[]; read: (root: string) => ReadOnlyInventory | null };

/** Registered readers, one entry per ecosystem. */
export const READONLY_READERS: ReadOnlyReader[] = [
  { ecosystem: "PyPI", files: PYTHON_FILES, read: readPython },
  { ecosystem: "Go", files: GO_FILES, read: readGo },
  { ecosystem: "crates.io", files: RUST_FILES, read: readRust },
];
