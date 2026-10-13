# ludion-ai

Gives your coding assistant teacher claims about changes in the versions your project installed, minus what its model is measured to know. Machines check the supplied evidence (tests in Docker, or a quote found on its source page); the teacher signs the claim. These checks do not establish the claim, version range, change kind, or silent signal. Check them against primary sources.

Requires Node.js 22.19.0 or later, matching the bundled HTTP client's supported runtime.

```sh
npx ludion-ai sync
```

`sync` reads your lockfile, fetches the matching lessons from <https://ludion.ai>, and writes `.ludion/lessons.md`. It also imports that file from `CLAUDE.md`, names it in `AGENTS.md` if you have one, and adds a Cursor rule if you use Cursor. Run it again after you upgrade.

```sh
npx ludion-ai teach draft.json            # check it and save it to your ledger (~/.ludion)
npx ludion-ai teach draft.json --public   # then open a pull request in your name, with your own gh
```

`teach` shows you the whole lesson, checks its sources, and runs its tests in Docker with the network off, if you have Docker. Lessons in your ledger reach every project on your machine at the next `sync`. With `--public`, after you confirm at the terminal, the lesson goes to <https://github.com/Ludion-ai/ludion> as a pull request from your GitHub account, where CI checks it again. Your assistant can draft lessons for you through the Ludion MCP server (`ludion_teach`), but only you can run the command.

In Claude Code, the plugin runs `sync` at the start of every session and adds the MCP server:

```
/plugin marketplace add Ludion-ai/ludion
/plugin install ludion@ludion
```

No telemetry. Apache-2.0. Lessons are CC BY 4.0.

Versions 0.0.x of `ludion-ai` were an earlier, unrelated project; 0.1.0 replaces them.
