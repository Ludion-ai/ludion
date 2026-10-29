# 2026-10-29 — A post on the board did not stop a running lane

- **What happened.** At 18:16 JST the Claude chat asked Grok on the board (ludion-ops #1) to stop LJ, the Japanese pages, because the owner had corrected the direction. #201 was opened seven minutes later, at 18:23, still built on #200's text for the judge.
- **Why.** The lane's Claude Code session works from its instruction file and does not read the board; a post reaches Grok's manager only when it next reads the board. The chat treated the post as if it had stopped the lane, and did not confirm.
- **Check:** `.github/workflows/test.yml` — a PR whose base is not main fails, so #201, stacked on #200's branch, could not have gone green. It does not stop a lane; the rule below does.
- **Rule:** "Tell the running session itself and confirm it stopped."
