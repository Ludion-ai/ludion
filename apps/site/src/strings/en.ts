// Availability describes this source preview; detection is not a security guarantee.
export const en = {
  "site": {
    "name": "Ludion",
    "description": "One workflow for security updates across PHP Docker, npm, Composer and Maven. Find relevant fixes, validate the application, and commit each fix to its own Git branch with a recorded result."
  },
  "nav": {
    "label": "Main",
    "skip": "Skip to content",
    "design": "How it works",
    "start": "Try the preview",
    "language": "日本語"
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
      "caption": "Your stack → relevant advisories → application checks → recorded updates.",
      "from": "stack",
      "update": "security update",
      "to": "your project"
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
      "invalidates": "Keep advisory ids, version inventories, image ids, source hashes and test outcomes in a local receipt, with each applied fix's branch and commit.",
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
      "applyDetail": "With --apply, commit each fix that passes on its own to a new Git branch. Your files and current branch stay unchanged. Production deployment remains a separate step.",
      "limits": "Online acquisition contains dependency manifests, not application source or host credentials. Application tests run offline. Source remains local to your configured Docker setup.",
      "unavailable": "Run watch --apply to repeat the saved ecosystem policy. A stop request cancels pending application; a Docker step already in flight may finish before exit.",
      "scope": "Workflow illustration, not a completed update. Nothing is installed or executed by this page.",
      "context": "security update",
      "reference": "security patch",
      "inline": "tested update",
      "replay": "Replay",
      "installFile": "dependency files",
      "runFile": "application test",
      "applyFile": "fix branch"
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
        "Each applied fix's branch and commit"
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
    "coverageTable": {
      "title": "Know the supported scope.",
      "label": "Supported ecosystems",
      "stack": "Your stack",
      "detect": "Detect",
      "apply": "Validate & apply",
      "boundary": "Current boundary"
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
  "start": {
    "title": "Try the multi-stack preview | Ludion",
    "description": "Check PHP Docker, npm, Composer and Maven security updates. Choose an update policy and application test before committing fixes to Git branches.",
    "heading": "One workflow. More of your stack.",
    "intro": "Scan the project, choose an ecosystem policy, then validate its security update against your application.",
    "copy": "Copy",
    "copied": "Copied",
    "selected": "Selected",
    "scan": {
      "heading": "Check your project",
      "where": "Source preview · Node 24+ · Docker for acquisition and validation. The published npm 0.1.4 release does not include these commands.",
      "run": "After building this source revision, run:",
      "copy": "Copy scan command",
      "wiring": "Replace /path/to/app with your project directory. Scan detects supported lockfiles and the configured PHP Dockerfile. Maven resolves its graph in a manifest-only container. The original project is not modified."
    },
    "path": {
      "label": "The update path",
      "steps": [
        { "title": "Detect", "detail": "Installed versions and relevant advisories" },
        { "title": "Validate", "detail": "Your application test, old and new" },
        { "title": "Apply", "detail": "One Git branch per fix" }
      ]
    },
    "coverage": "PHP Docker · npm · Composer · Maven. An unavailable database or unsupported inventory stays visible. Production is not automatically redeployed.",
    "reference": "From discovery to a validated update",
    "source": {
      "summary": "1 · Build the source preview",
      "note": "Keep the existing npm install separate",
      "body": "Use the multi-stack source revision. These commands become available on the default branch when its pull request is merged.",
      "copy": "Copy source setup"
    },
    "init": {
      "summary": "2 · Choose the ecosystem and test",
      "note": "Required before validation",
      "choose": "Choose php, npm, composer or maven. A project may scan several ecosystems together; its saved patch policy selects one manager at a time.",
      "copy": "Copy init command",
      "edit": "Edit ludion.security.json to select an official tool image matching your application and its real offline test command. npm acquisition uses npm 12.2.1; its Node tool image must support that version.",
      "tests": "Tests must run with a read-only project and write only to supported scratch areas. Maven's online model excludes custom build/plugin configuration; those plugins must already be available for offline tests or validation will stop."
    },
    "apply": {
      "summary": "3 · Validate, then apply",
      "note": "Branches are opt-in",
      "validate": "Acquire dependencies separately, run baseline/candidate tests offline and recheck the candidate inventory:",
      "copyValidate": "Copy validation command",
      "apply": "To validate again and commit each fix that passes on its own:",
      "copyApply": "Copy apply command",
      "branchesBefore": "--apply does not change your files or your current branch. Each fix becomes one commit on its own new branch, ",
      "branchesAfter": ", and nothing is pushed. Fixes that pass only together are not applied. A fix whose branch already exists is not applied again. An OSV malicious-package record (MAL-) on any installed package stops every fix in the run.",
      "needs": "--apply needs git installed outside the project, and a Git repository whose files are exactly those of its last commit. Uncommitted, untracked or ignored files (other than node_modules and .env files, and for npm, Composer and Maven a top-level vendor or target), Git LFS, submodules or Git configuration that names hooks make it refuse; run without --apply to validate only.",
      "review": "Review .ludion/security/ for the receipt. npm/Composer may adjust dependency constraints within the same major and regenerate the lockfile. Maven can add dependencyManagement constraints for vulnerable transitives. Major-version fixes and unresolved cases require review. Merge a branch, then deploy through your normal process."
    },
    "watch": {
      "summary": "4 · Keep checking automatically",
      "note": "While the process is running",
      "repeat": "Repeat the saved ecosystem policy every 900 seconds:",
      "copy": "Copy watch command",
      "stop": "Ctrl+C requests a stop. An in-flight Docker step may finish, but no branch is made after cancellation is received. A later run skips fixes whose branch already exists."
    },
    "privacy": {
      "summary": "What leaves your machine",
      "note": "Requests and boundaries",
      "requests": "Package names and exact versions are sent to OSV (api.osv.dev), and the IDs of the advisories it returns are sent back to it. Composer package names are also sent to Packagist's advisory list (packagist.org). To read versions, release times and provenance, npm package names and versions are sent to the npm registry (registry.npmjs.org), and Composer package names to Packagist (repo.packagist.org). PHP's release list is read from www.php.net, which is sent the PHP branch, such as 8.4. CISA's catalog of exploited vulnerabilities (www.cisa.gov) and FIRST's daily list of EPSS scores (epss.empiricalsecurity.com) are downloaded whole, so no CVE ID is sent. The scheduled workflow's PR job uses GitHub with the workflow's token: it reads your repository and its PRs, pushes each fix's commit to its own branch and opens a PR whose title and body carry the package names, versions, advisory IDs and the receipt's times. It also asks Docker Hub (auth.docker.io, registry-1.docker.io) for the digest of the official PHP image's tag. Tool images, the official PHP image included, come through your Docker daemon from the registry it is configured with. npm packages come from registry.npmjs.org with URL/Git/file sources disabled, and Maven repositories are mirrored to public Central (repo.maven.apache.org). Composer ZIPs come only from commit-pinned archives on github.com, api.github.com, codeload.github.com or bitbucket.org, and every redirect is checked before the next request.",
      "source": "Application source is sent to your configured Docker daemon for offline tests; choose a local daemon to keep it on your machine. No source is uploaded to Ludion and security commands send no telemetry. Online acquisition contains manifests only. Source snapshots exclude .env files, Git history and common credential directories, but they are not general secret scanners. This website uses Google Analytics."
    },
    "summary": "Known advisories and recorded application tests only. No match is not a security guarantee. Supported scope and unhandled cases stay explicit."
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
