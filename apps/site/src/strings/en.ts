// Availability describes this source preview; detection is not a security guarantee.
export const en = {
  "site": {
    "name": "Ludion",
    "description": "One workflow for security updates across PHP Docker, npm, Composer and Maven. Find relevant fixes, validate the application, and update source with a recorded result."
  },
  "nav": {
    "label": "Main",
    "skip": "Skip to content",
    "design": "How it works",
    "start": "Try the preview"
  },
  "home": {
    "title": "Ludion — One workflow for security updates",
    "headline": [
      "Keep building.",
      "Keep your stack moving."
    ],
    "sub": "Find security fixes across PHP, JavaScript, TypeScript and Java. Validate the change, update the project, and see what still needs attention.",
    "start": "Try the preview",
    "seeItWork": "See the workflow",
    "scroll": "Follow the update",
    "coverage": "Source preview · PHP Docker, npm package-lock, Composer and standalone Maven. Source updates are validated locally; production deployment stays with your release process.",
    "example": "Illustrated workflow. Run the preview to produce your own results.",
    "scene": {
      "caption": "Your stack → relevant advisories → application checks → recorded updates."
    },
    "chapters": {
      "label": "The update workflow",
      "guard": "Detect",
      "verify": "Check",
      "isolate": "Update",
      "receipt": "Record"
    },
    "guard": {
      "title": "One view of the updates your project needs.",
      "states": [
        {
          "id": "update",
          "detail": "A relevant PHP security release or known advisory matches an inventoried dependency. Plan an update within the supported version policy."
        },
        {
          "id": "no-match",
          "detail": "No matching update was found in the recorded inventory. This is not a guarantee that the application is secure."
        },
        {
          "id": "unknown",
          "detail": "A source cannot be reached or read, or the project changed while checking. Report the gap instead of marking the project clear."
        },
        {
          "id": "unsupported",
          "detail": "An unsupported manifest, unresolved model or untrusted acquisition path needs review. It remains visible instead of being silently skipped."
        }
      ],
      "note": "Read installed versions from npm and Composer lockfiles, or resolve a standalone Maven dependency graph. PHP runtime releases use the configured Dockerfile. Dependency advisories come from OSV."
    },
    "verify": {
      "title": "Check every update.",
      "bar": "update.check",
      "stepsLabel": "Validation steps",
      "steps": {
        "guard": "Match",
        "program": "Resolve",
        "verifier": "Test",
        "receipt": "Record"
      },
      "guardBody": "Identify exact versions and match them against published advisories. Keep existing package majors; fixes that require a major upgrade stay visible for review.",
      "programBody": "Resolve packages in a separate acquisition environment. Keep application files out of online resolution, constrain download sources, and pin the tool image by digest.",
      "verifierBody": "Build baseline and candidate application images. Run your configured test offline on both and recheck the candidate dependency inventory for known advisories.",
      "notVerified": "A failed baseline, failed candidate, remaining advisory, incomplete inventory or changed project blocks application. Passing tests establish only the recorded application behavior.",
      "invalidates": "Keep advisory ids, version inventories, image ids, source hashes and test outcomes in a local receipt. Multi-file dependency updates have a recovery journal.",
      "sameModel": "You choose the application test. Ludion does not invent a passing test, weaken it, or treat an unavailable database as a clean result."
    },
    "isolate": {
      "title": "Resolve once. Check the app. Apply by policy.",
      "bar": "patch.workflow",
      "stagesLabel": "Update stages",
      "install": "1 · Resolve",
      "installDetail": "Acquire dependencies separately from application testing. npm blocks URL/Git/file dependencies; Composer archives are checked at each redirect; Maven uses public Central.",
      "run": "2 · Validate",
      "runDetail": "Run the original and updated application tests in Docker with no network, a read-only source/root, a non-root user and fixed scratch/resource limits. Check the resulting inventory again.",
      "apply": "3 · Apply",
      "applyDetail": "With --apply, change only the supported Dockerfile or dependency files after validation. Keep a receipt and journal. Production deployment remains a separate step.",
      "limits": "Online acquisition contains dependency manifests, not application source or host credentials. Application tests run offline. Source remains local to your configured Docker setup.",
      "unavailable": "Run watch --apply to repeat the saved ecosystem policy. A stop request cancels pending application; a Docker step already in flight may finish before exit.",
      "scope": "Workflow illustration, not a completed update. Nothing is installed or executed by this page."
    },
    "receipt": {
      "title": "Know what changed, and what remains.",
      "bar": "update.receipt · example",
      "fields": [
        "Advisory source and matching ids",
        "Before / after dependency inventories",
        "Source tree and dependency file hashes",
        "Tool image digest and application image ids",
        "Application test command",
        "Baseline / candidate test outcome",
        "Candidate advisory recheck",
        "Applied files and recovery journal"
      ],
      "results": "Production deployment",
      "pending": "Recorded per run",
      "notDeployed": "Not changed",
      "scope": "Receipt structure, not a run result. Actual receipts stay in .ludion/security/. No security certification is implied."
    },
    "closing": {
      "title": "Bring more of your stack into one workflow.",
      "action": "Try the multi-stack preview"
    },
    "supported": [
      {
        "name": "PHP runtime",
        "detect": "Official security releases",
        "apply": "Dockerfile update",
        "scope": "Exact official PHP image; single stage; same major/minor branch."
      },
      {
        "name": "JavaScript / TypeScript",
        "detect": "npm lockfile + OSV",
        "apply": "Manifest + lockfile",
        "scope": "Public npm registry; package-lock v2/v3; no workspaces, URL/Git/file deps or major upgrades."
      },
      {
        "name": "PHP packages",
        "detect": "Composer lockfile + OSV",
        "apply": "Manifest + lockfile",
        "scope": "Public pinned ZIP archives; standard vendor directory; no custom repositories or policy overrides."
      },
      {
        "name": "Java / Maven",
        "detect": "Resolved graph + OSV",
        "apply": "POM + dependency constraints",
        "scope": "Standalone POM; public Maven Central. Parents, profiles, modules and extensions need review."
      }
    ],
    "supportedNote": "Yarn/pnpm discovery is partial and does not enable automatic patching. Python, Go, Rust, Gradle, live server inventory, runtime upgrades beyond PHP and automatic production deployment are not supported in this preview. Custom build tools may need an explicitly trusted offline cache."
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
