## 2026-10-28 (cycle 3, L1) — The noise rerun's result; what is left open

- The rebuilt split ran as registered (first execution at c381a85; docs/bench/2026-10-28-noise-v2). The count gate is not met: 938 × 3 > 1,867. The miss gate is not met: 11 misses in 4 repositories. No definition is changed.
- Left open for a new entry and a new run: requires whose argument is not a literal (9 of the 11 misses), a tool that loads a package it does not declare (webpack's launcher and webpack-cli; `astro check` and @astrojs/check, where the reviewers read P6 differently), command sources section 2 does not list (CI workflows, other scripts, `.jsonc`), and how to bring the count down.
- judge.yml passes no `--source`, so this repository's own PRs get only D1. Adding `--source` is a change to a protected path, left to the owner.

