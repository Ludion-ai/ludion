# Re-judged with corrected answer keys: 2026-10-11

On 2026-10-11 all 45 answer keys of the 2026-10-08 run were checked against primary sources (docs pages, or source at the release tag; `docs/bench/2026-10-11-keys/`). 40 were confirmed and 5 corrected:

- `vitest-5-0-0-6`: WebdriverIO was **not** removed. `@vitest/browser-webdriverio` moved to the vitest-community organization and is community-maintained.
- `vitest-5-0-0-5`: `@vitest/runner` is deprecated (Vitest 5 bundles its runner); it was not unpublished.
- `agents-0-19-0-21`: `@cloudflare/think` requires `ai@^7` only; the others accept `^6 || ^7`.
- `wrangler-4-145-0-11`: the command move was right, but the key missed the Basin SQL token rename.
- `wrangler-4-125-0-19`: the `connect` trigger also takes `udp`, and the "experimental flag" isn't in any primary source.

The 2026-10-08 answers to those 5 changes were judged again with the corrected keys (same judge prompt, same model). This changed nothing else, and no answer was re-generated. Every answer to a corrected question is now graded wrong, in every condition.

## Corrected scores (`corrected-scores.json`)

| | wrangler | agents | vitest | all |
| - | - | - | - | - |
| A, no tools | 0/15 | 2/15 | 1/15 | 3/45 (7%) |
| A, web search | 6/15 | 10/15 | 4/15 | 20/45 (44%), was 47% |

| vitest B (10 questions) | no tools | web | no tools + drafts | web + drafts |
| - | - | - | - | - |
| correct | 2/10 | 4/10 | 9/10 | 9/10, was 10/10 |

**A wrong draft taught a wrong fact.** The WebdriverIO draft repeated the wrong key, and with it in context the agent said WebdriverIO was removed, so the drafts conditions drop from 10/10 to 9/10. A lesson built from a changelog headline, without a primary source, can make an assistant worse. That is why lesson format 1 requires a source quote that states the fact itself and names the symbol (`docs/decisions.md`, "Lesson format 1").

Cost of the re-judging: $0.39 (16 judge calls). Files: `questions.json` (with corrected keys), `answers-*.json` (the re-judged subset), `grades-*.json`, `runs/judge-*/`.
