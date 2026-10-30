# 2026-10-30 — On Windows, PATH folders were compared without resolving junctions

- **What happened.** findProgram (packages/sandbox/src/docker.ts) compared PATH folders as written on Windows, while the project root was a real path. A junction or subst drive leading into the repository, such as an activated `.venv\Scripts` holding a `git.exe`, was therefore not seen as inside, and that program could have run on the host. Found by the post-merge review of #204; not seen in use.
- **Why.** The real-path comparison was added for POSIX links and left out on Windows, where the JavaScript walk does not resolve subst drives or short names. CI has no Windows job, so nothing exercised that branch.
- **Rule:** "Never run project-controlled or downloaded code or commands on the host."
