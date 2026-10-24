# Capability Compiler handoff

Product target: Capability Compiler
Repository / branch / HEAD: Ludion-ai/ludion / v3/capability-compiler / the commit that adds this file (parent 671cefd WIP). Run `git log -1` for the exact hash.
Current stage: P1 done (types, hashing, structural guard, receipt validation; no execution). P2..P6 not started.
Implemented: `packages/capability/` (`@ludion/capability`, zod ^4.6.5 only): `src/schema.ts`, `canonical-json.ts`, `hash.ts`, `node-version.ts`, `glob.ts`, `scan.ts`, `guard.ts`, `receipt.ts`, `index.ts`; `scripts/gen-json-schema.ts`; generated `capability.schema.json`, `receipt.schema.json`; tests `hash`, `guard`, `receipt`, `schema` (24 tests covering draft section 4 items 1-10 plus near-miss cases). Root `package.json` script `gen:capability-schema`; `package-lock.json` workspace link.
Checked: command / result / artifact path
- `npm run typecheck` / exit 0 / log kept outside the repository
- `npm run build` / exit 0 / log kept outside the repository
- `npm test` / exit 0, 32 files / 484 tests passed (baseline 28 / 460) / log kept outside the repository
- `npm run gen:capability-schema` / exit 0, no diff against committed schemas
Not run / unavailable: any container/Docker execution (Docker Desktop 4.96.3 installed but daemon not running: "Docker Desktop is unable to start", no WSL distro); CI on this branch; real program/verifier execution (P2); recipient runs (P4).
Source trace and capability artifact: none yet; P1 has only unit fixtures in `packages/capability/test/fixtures.ts` (vitest `restoreAllMocks` example from the draft).
Recipient and near-miss results: unit-level only: near-miss guard cases (alias, shadowed/type-only import, comments/strings, existing clearAllMocks, dynamic config, version mismatch) produce the expected inapplicable/unknown. No real recipient measured.
Spent / remaining budget if measured: not measured. Grok CLI ran on the grok.com subscription login (no API key); no paid API used.
Open PRs and review requirements: no PR opened. Generated schemas are treated as protected: REVIEW_REQUIRED by CTO, and security head for the verifier/write boundary.
Next exact command: P2: get Docker running (start Docker Desktop / install WSL2 distro), then implement the runner that records image digest, mounts the verifier fresh after program execution, and writes `verifier_runtime`; first measurement `npm test` + runner on vitest 4.0.x-4.1.x to widen applicable versions with evidence.
Decision still uncertain: conservative literal-prefix overlap check forbids broad write globs (fixture uses `src/**/*.test.ts`, `test/**/*.test.ts`); whether to trust the recipient's vitest binary (`vitest_path`); scanner is a tokenizer not a full parser; contract_id source (explicit caller input only for now); zod JIT on Workers (not used in P1).