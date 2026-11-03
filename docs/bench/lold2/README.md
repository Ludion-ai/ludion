# LOLD2: the oldest version in range, in the product

The definitions are in docs/decisions/2026-11-03-oldest-resolution-in-product.md, committed at 6bc7f83 before any of the code was written. The result is docs/progress/2026-11-03-lold2-oldest-in-product.md. The code is packages/cli/src/security/oldest.ts.

## Files

| Path | What it is |
|---|---|
| `scripts/run.mjs` | The product's `resolveOldest`, script, `unneededMoves`, `notOldest`, `recheckOldest`, judge and asserts on LOLD's 24 examples, with the real npm 12.2.1, the real registry and the real OSV. The one difference from the product: the script starts the npm in `/vol/npm12` rather than the image's global one |
| `scripts/context.mjs` | Writes the Docker build context `ludion patch` writes for one fix, to build the real Dockerfile |
| `scripts/summary.mjs` | Counts from `results/`, with no network |
| `scripts/mutate.mjs` | Breaks each check in turn in the Docker volume's copy; the tests must fail |
| `scripts/record.mjs` | Records the packument copies in packages/cli/test/fixtures/oldest-packuments, keeping publish times, requirements and deprecations |
| `results/`, `summary.json` | The run, per example and counted |
| `mutations.json` | The mutation run |

## How to run it

In Docker only: `node:24` by digest, the worktree read-only at `/w`, a copy of it with its dependencies at `/vol/app` in a volume owned by uid 1000, and npm 12.2.1 at `/vol/npm12`, all with install scripts off.

```sh
docker run --rm --user node --cap-drop ALL --memory 4g -e HOME=/vol/home -v <worktree>:/w:ro -v <volume>:/vol -w /vol/app node:24 node /w/docs/bench/lold2/scripts/run.mjs /vol/lold2
docker run --rm --user node --cap-drop ALL --memory 4g --network none -e HOME=/vol/home -v <worktree>:/w:ro -v <volume>:/vol -w /vol/app node:24 node /w/docs/bench/lold2/scripts/mutate.mjs /vol/lold2/mutations.json
```

The registry and OSV change every day, so a later run can differ. `run.mjs` has no retry: in the run behind `results/`, R09 failed on `api.osv.dev answered HTTP 503` and passed when run again, and `results/` holds the later run. That run took two sittings, since the first stopped at its time limit after 16 examples. In an earlier run of the same day, R11 failed the same way.

`mutate.mjs` takes a first index and an index to stop before, since the whole list is longer than one sitting. `mutations.json` puts the parts of its runs together: 43 entries from the tree at e2ec262, and 6 (three new, three whose text changed) from later heads, each with `head` saying which. `mutate.mjs --check` says whether each entry's text is in its file exactly once, and runs nothing.
