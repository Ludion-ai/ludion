# ludion

Tells your coding assistant what changed in the versions your project installed: only the changes for those versions, minus what its model is measured to know. Every lesson is checked by a machine (a test in Docker, or a quote found on its source page) and signed by the person who taught it.

```sh
npx ludion sync
```

`sync` reads your lockfile, fetches the matching lessons from <https://ludion.ai>, and writes `.ludion/lessons.md`. It also imports that file from `CLAUDE.md`, names it in `AGENTS.md` if you have one, and adds a Cursor rule if you use Cursor. Run it again after you upgrade.

```sh
npx ludion teach draft.json            # check it and save it to your ledger (~/.ludion)
npx ludion teach draft.json --public   # then open a pull request in your name, with your own gh
```

`teach` shows you the whole lesson, checks its sources, and runs its tests in Docker with the network off, if you have Docker. Lessons in your ledger reach every project on your machine at the next `sync`. With `--public`, after you confirm at the terminal, the lesson goes to <https://github.com/Ludion-ai/ludion> as a pull request from your GitHub account, where CI checks it again. Your assistant can draft lessons for you through the Ludion MCP server (`ludion_teach`), but only you can run the command.

No telemetry. Apache-2.0. Lessons are CC BY-SA 4.0.
