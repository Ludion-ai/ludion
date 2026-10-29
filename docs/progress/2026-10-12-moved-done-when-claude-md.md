## Done when (CLAUDE.md)

| | Check | State |
| - | - | - |
| 1 | Single player: a lesson taught in project A shows up via `ludion sync` in project B, and Claude Code in B gets right the task it got wrong before | **shown**: 1/5 before, 5/5 after sync, 3/3 through the plugin hook (`docs/bench/2026-10-11-done1/`) |
| 2 | Plumbing: `ludion teach --public` → merge → within five minutes `ludion sync` elsewhere writes it with the teacher's name, and `ludion_ask` returns it | **shown** (2026-10-13, `docs/bench/2026-10-13-done2/result.json`): #97 (vitest 4.0 `vi.restoreAllMocks`, `teach --public` by `Ludion-ai`) merged at 08:40:22 UTC; the site listed it after 67 s, `ludion sync` wrote it with `Taught by @Ludion-ai` after 74 s, `ludion_ask` returned it after 75 s (limit 300 s); one lesson, one run |
| 3 | Value: FreshBench on the wedge, Claude Code with default tools in a project with the new version installed, with vs without `ludion sync`: +20 points | B questions on the frozen seeds: **36/45 vs 24/45 (+27)** (`docs/bench/2026-10-11-done3/`). C tasks: running, one trial per task over several days |

