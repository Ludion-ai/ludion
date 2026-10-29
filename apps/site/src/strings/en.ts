// The judge as README.md and docs/status.md describe it: a preview that comments on npm dependency PRs. Not a security guarantee.
export const en = {
  "site": {
    "name": "Ludion",
    "description": "A judge for npm dependency-update PRs. Ludion reads the lockfile change, checks provenance, publishers, install scripts and malicious-package records, counts the wait, and leaves one comment. A preview, not released."
  },
  "nav": {
    "label": "Main",
    "skip": "Skip to content",
    "design": "How it works",
    "start": "Try the preview",
    "switch": "日本語",
    "switchLang": "ja"
  },
  "home": {
    "title": "Ludion — a judge for npm dependency updates",
    "headline": [
      "An npm dependency PR,",
      "judged in one comment."
    ],
    "sub": "Ludion reads an npm dependency-update PR and leaves one comment: stop, wait, ready except build, or undecidable. Comments only, nothing is merged.",
    "start": "Try the preview",
    "seeItWork": "See the verdicts",
    "scroll": "Follow a dependency PR",
    "coverage": "Preview, not released · npm package-lock.json v2/v3; a pnpm-lock.yaml, read only by the local command, is always undecidable. The judge changes no file and merges nothing.",
    "example": "Illustrated judgement. Not a run result.",
    "scene": {
      "caption": "A dependency PR → its lockfile diff → checks → one comment, with when the wait ends.",
      "pr": "dependency PR",
      "comment": "one comment"
    },
    "chapters": {
      "label": "How the judge works",
      "guard": "Verdicts",
      "verify": "Checks",
      "isolate": "Flow",
      "receipt": "Comment"
    },
    "guard": {
      "title": "Four verdicts. None of them is “apply”.",
      "states": [
        {
          "id": "stop",
          "detail": "A check found a reason not to take the update. Among them: provenance lost or from another repository or workflow, a new install script, an OSV MAL- record, deprecation or withdrawal, a downgrade or a new advisory, a version that moved with the fix and is too new, a lockfile entry whose tarball or hash does not match, or a change to other files, to package.json beyond its dependency lists and overrides, or to a range or override outside the registry."
        },
        {
          "id": "wait",
          "detail": "Nothing stopped it, but the newest changed version is still inside its wait: 12 hours for an exploited fix (24 without comparable provenance), 24 for high, 72 for normal. A publisher change, new dependencies or a package with no earlier version to compare doubles it, to at least 72 hours. The comment says until when."
        },
        {
          "id": "ready_except_build",
          "detail": "Gates 1, 2 and 4 found nothing and the wait is over. Gate 3, building and testing old and new, is not run, so this is not a verdict that the update can be applied."
        },
        {
          "id": "undecidable",
          "detail": "Something could not be read or looked up, the PR changes .github/ or 300 or more files, or, run locally, the lockfile is pnpm-lock.yaml. It is shown as undecidable, never as clear."
        }
      ],
      "note": "Read from the PR's package.json and package-lock.json, before and after, with the npm registry and OSV. Every changed version counts as production: there is no dev-only split."
    },
    "verify": {
      "title": "Check every changed package.",
      "bar": "judge.checks",
      "stepsLabel": "What the judge checks",
      "steps": {
        "paths": "Paths",
        "source": "Source",
        "moves": "Moves",
        "lockfile": "Lockfile"
      },
      "pathsBody": "Every install path whose package or version changes is checked for downgrades and for known advisories the old version did not have, and so is every package a dependent now loads instead: shadowing, moved dependents, removed copies, aliases.",
      "sourceBody": "Provenance must stay, naming the same repository and workflow. A new install script, an OSV MAL- record, deprecation or withdrawal stops. A publisher change, new dependencies or a package with no earlier version to compare extend the wait.",
      "movesBody": "Every version that moves with the fix must already be in the lockfile or published before the fix, unless it is part of the same release: provenance naming the same repository, workflow and commit, or, with no provenance on either, the same publisher and version number, published at most 15 minutes after the fix. A new dependency whose package first appeared less than the base wait before the fix stops.",
      "lockfileBody": "The changed files, package.json, each changed entry's registry tarball and its sha512 integrity are checked. A workspace package.json that does not agree with the lockfile stops.",
      "notVerified": "Not run: gate 3, building and testing old and new. Not inspected: obfuscated code, new network or process calls, and OS or configuration conditions.",
      "hijack": "A hijacked publisher account with no provenance change is caught only by the wait and by running the judge again when it ends. Nothing schedules that second run."
    },
    "isolate": {
      "title": "Read the diff. Check it. Count the wait. Comment.",
      "bar": "judge.flow",
      "stagesLabel": "Judge stages",
      "read": "1 · Read",
      "readDetail": "Read the PR's package.json and package-lock.json, before and after, and list every install path whose package or version changes. Nothing from the PR is run.",
      "check": "2 · Check",
      "checkDetail": "Look up each changed version in the npm registry and OSV: provenance, publisher, install scripts, MAL- records, deprecation, withdrawal and new dependencies.",
      "comment": "3 · Count the wait, comment",
      "commentDetail": "Count the wait from the newest publish and write one comment on the PR at once. If nothing stopped it and the wait has not ended, the verdict is wait, with the time it ends. Later runs update the same comment. No file is changed and nothing is merged.",
      "limits": "The judging job has read access only and runs no dependency code. A second job, from your default branch, checks its result as untrusted data and posts the comment.",
      "unavailable": "When a wait ends, nothing re-checks the PR by itself: the judge looks again only when it runs again.",
      "scope": "Flow illustration, not a judgement. Nothing is installed or run by this page.",
      "visual": {
        "context": "dependency PR",
        "reference": "read by the judge",
        "inline": "one comment",
        "noChange": "no change",
        "replay": "Replay",
        "files": {
          "read": "package-lock.json",
          "check": "registry + OSV",
          "comment": "PR comment"
        }
      }
    },
    "receipt": {
      "title": "One comment: what it found, and what it did not check.",
      "bar": "PR comment · example",
      "fields": [
        "Verdict and the head it judged",
        "Urgency and the wait, from the newest publish",
        "Versions that move with the fix",
        "Changed packages, from → to",
        "Advisories the update fixes, when it fixes any",
        "Each finding: stop, extend or info, and its gate",
        "Exposure: when the fix was published, when the judge saw it"
      ],
      "pending": "In each judgement",
      "notCheckedTitle": "Not checked",
      "notChecked": [
        "Gate 3: building and testing old and new versions.",
        "Obfuscated code and new network or process calls in the changed code.",
        "Gate 1's OS, SAPI and configuration conditions; every changed version counts as production.",
        "Provenance's Sigstore signature and certificate: the registry's attestation record is read, not verified.",
        "A hijacked publisher account with no provenance change, beyond the wait and a judge run after it.",
        "The legacy dependencies section of a v2 lockfile.",
        "A newly required dependency that lands on a copy already installed."
      ],
      "results": "Gate 3, build and tests",
      "notDeployed": "Not run",
      "scope": "Comment structure, not a judgement. A head that changes .github/ or 300 or more files, or a run where the judge gives no output, gets a short undecidable comment without these fields. The judge changes no file and merges nothing. No security certification is implied."
    },
    "closing": {
      "title": "Put a judge behind your dependency PRs.",
      "action": "See how to set it up"
    },
    "coverageTable": {
      "title": "Know what the judge reads.",
      "label": "What the judge reads",
      "input": "Input",
      "read": "Read",
      "checked": "Checked",
      "boundary": "Current boundary"
    },
    "supported": [
      {
        "name": "package-lock.json",
        "read": "v2/v3 packages, before and after",
        "checked": "Gates 1, 2 and 4 in part, and the wait",
        "scope": "The root lockfile; its legacy dependencies section is not compared."
      },
      {
        "name": "package.json",
        "read": "The root one, and each changed */package.json",
        "checked": "Gate 4: the root one may change only its dependency lists and overrides, on the registry",
        "scope": "A workspace package.json that does not agree with the lockfile stops; one that cannot be read on both sides is undecidable."
      },
      {
        "name": "pnpm-lock.yaml",
        "read": "The versions it adds",
        "checked": "Each added version, without its tarball, hash or what loads it",
        "scope": "Always undecidable. Only the local command reads it; the workflow runs on package-lock.json changes, so a pnpm PR gets no comment."
      },
      {
        "name": "Pull request",
        "read": "Its changed files",
        "checked": "Nothing from the PR is run",
        "scope": "A PR that changes .github/ or 300 or more files is undecidable. Comments go only to PRs into the default branch."
      }
    ],
    "supportedNote": "npm only. Ludion does not find vulnerabilities or write updates: Dependabot, Renovate or a person opens the PR, and the judge stands behind it. Package names and versions are sent to OSV and the npm registry; no source is sent."
  },
  "start": {
    "title": "Judge your npm dependency PRs | Ludion",
    "description": "Add the Ludion judge to a repository as two GitHub workflows, or run it locally against two checkouts. A preview that only comments; not released yet.",
    "heading": "Judge your npm dependency PRs.",
    "intro": "Add two workflows to a repository, or run the judge locally against two checkouts. Preview: comments only; nothing is merged.",
    "workflows": "Add two workflows",
    "notReleased": "Not released yet · No release commit exists yet. The action needs one, because only a release commit carries the bundled judge; at any other commit it stops with an error. When one is published, pin its full 40-character SHA, not a tag or branch, in both workflows.",
    "judgeIntro": "The first judges with read access only and runs nothing from the PR:",
    "judgeLabel": "The judging workflow",
    "commentIntro": "The second posts the result. It runs from your default branch after each judge run, checks the result as untrusted data, and keeps one comment per PR up to date:",
    "commentLabel": "The comment workflow",
    "pinNote": "A change to that SHA (from Dependabot, for example) is an update to Ludion itself: review it like any dependency update, and do not auto-merge it. The judge is not a required check unless you make it one.",
    "pathLabel": "What the judge does",
    "flow": [
      {
        "title": "Read",
        "detail": "The PR's package.json and package-lock.json, before and after"
      },
      {
        "title": "Check",
        "detail": "Provenance, publisher, install scripts, MAL- records, deprecation, new dependencies"
      },
      {
        "title": "Comment",
        "detail": "One verdict, with when the wait ends and what was not checked"
      }
    ],
    "coverage": "npm only · Parts of gates 1, 2 and 4, and the wait. Gate 3, building and testing, is not run, so the judge never says an update can be applied.",
    "reference": "Running it, and its limits",
    "local": {
      "summary": "Run the judge locally",
      "note": "Two checkouts, before and after",
      "build": "The published npm ludion-ai 0.1.4 release is the earlier lesson product, which ended on 2026-10-28; no release of the judge is on npm yet. Build this repository (Node 24):",
      "run": "Then give the judge two checkouts of your project, before and after the update, and the files the update changes:",
      "exits": "Exit codes: 0 ready except build (gates 1, 2 and 4 found nothing and the wait is over); 3 wait; 1 stop or undecidable, also when a lookup fails or --files is missing; 2 the inputs could not be read. --json gives the whole judgement. A pnpm-lock.yaml is read as the set of versions it adds, which is always undecidable."
    },
    "limits": {
      "summary": "Limits",
      "note": "What the action reads",
      "body": [
        "GitHub-hosted Linux runners: the action needs gh, jq, unzip, GNU date and Node 22 or later. Only the root package.json and package-lock.json, and each changed */package.json, are read. A workspace package.json is left out of gate 4's changed-files stop when it agrees with the lockfile; one that does not agree stops, and one that cannot be read on both sides, such as an added, removed or renamed workspace's, is undecidable.",
        "A PR that changes .github/ or 300 or more files is shown as undecidable. The comment job posts only for PRs into the default branch. When a wait ends, nothing re-checks the PR by itself: the judge looks again only when it runs again.",
        "A hijacked publisher account with no provenance change is caught only by the wait and by running the judge again when it ends."
      ]
    },
    "privacy": {
      "summary": "What leaves your machine",
      "note": "Requests and boundaries",
      "body": [
        "Package names and versions are sent to OSV and the npm registry. No source is sent, and no dependency code is run.",
        "The judging job has read access only; the comment job runs from your default branch and treats the judge's result as untrusted data. This website uses Google Analytics."
      ]
    },
    "summary": "No comment, or an undecidable one, means neither safe nor cleared. Each judgement lists what the judge did not check.",
    "copy": {
      "copy": "Copy",
      "copied": "Copied",
      "selected": "Selected",
      "judgeWorkflow": "Copy the judging workflow",
      "commentWorkflow": "Copy the comment workflow",
      "build": "Copy build commands",
      "judge": "Copy judge command"
    }
  },
  "footer": {
    "license": "Code is Apache-2.0.",
    "github": "GitHub",
    "analytics": "This site uses Google Analytics."
  },
  "notFound": {
    "title": "No page here",
    "body": "No page here.",
    "home": "Go to the home page",
    "rest": " or try the preview."
  }
};
