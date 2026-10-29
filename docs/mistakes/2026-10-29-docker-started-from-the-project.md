# 2026-10-29 — `docker` was started from the folder ludion runs in

- **What happened.** packages/sandbox/src/docker.ts started every `docker` process by name from the inherited working directory. Windows looks a program up in the working directory before PATH, and elsewhere an empty PATH entry means the working directory. `ludion patch` is usually run inside the project, so a project that ships a `docker.exe` (or a `docker` file, with such a PATH) would have had it run on the host, outside the sandbox. The review of PR #204 found the same problem for `git` and fixed it there; this is the same lookup in the sandbox. No report of it being used is known.
- **Why.** The sandbox's hardening was written for the container (no network, read-only root, no forwarded environment), and the step before the container, which program the host runs, was taken as given.
- **Check:** `packages/sandbox/test/docker-lookup.test.ts` — with a real spawn, a `docker` in the working directory and PATH naming the working directory, it is not run.
- **Check:** `packages/sandbox/test/docker.test.ts` — every `docker` process, the timeout kill included, starts in one empty private folder.
- **Rule:** "Never run project-controlled or downloaded code or commands on the host."
