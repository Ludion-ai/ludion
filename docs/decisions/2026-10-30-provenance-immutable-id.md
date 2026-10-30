# 2026-10-30 — Provenance is also compared by the repository's immutable id, and only push, release and workflow_dispatch may publish

**Owner, 2026-10-30, to the owner's Claude chat**, in the owner's words: 19:17 「今は関門をアルゴリズムでやるって話だったよね。時間指定の場合、例外が発生すれば終わる」「Githubとかの最新資料確認して」; 19:24 「出していい」「使命に対しては一切妥協するな」「イーロンの第一原理思考の様に、疑え」「一般論を信じ切るな」. The Claude chat turned this into the direction that the gates decide on evidence Ludion makes itself; evidence borrowed from others (the time someone else takes to notice, the publisher's own statement of provenance, the user's own tests) is used as a reason to stop, never as a reason to let an update through. This record is the first, small step of that direction: it adds stop conditions only.

## Why

- **A name can be taken again.** npm's trusted publishing tied its trust to the repository's name (owner/repo) until the first publish. An attacker who re-registered a freed name could publish someone else's package through the correct procedure (SlugFest, reported 2026-06-06, more than 1,500 packages: https://thehackernews.com/2026/10/github-tightens-npm-publishing-after.html). The provenance of such a version names the same repository and the same workflow path as the real releases.
- **Ludion compared the name only.** Gate 2's provenance comparison, the same-release exception and the next fix's same-publisher check read `externalParameters.workflow.repository` and `workflow.path` (packages/cli/src/security/npm-facts.ts, provenanceFrom) and nothing else, so a SlugFest version passed all three.
- **The id is in the statement.** npm's provenance records GitHub's numeric repository id and the event that started the run: SLSA v1 in `predicate.buildDefinition.internalParameters.github` (`repository_id`, `repository_owner_id`, `event_name`; https://app.unpkg.com/npm@11.12.1/files/node_modules/libnpmpublish/lib/provenance.js), and the earlier SLSA v0.2 statements from npm 9 in `predicate.invocation.environment` (`GITHUB_REPOSITORY_ID`, `GITHUB_EVENT_NAME`; libnpmpublish in npm 9.5.0). A re-registered name gets a new id.
- **Some events let others start the publish.** npm refuses trusted publishing from `pull_request_target` and, since 2026-10-02, from `issue_comment` (https://github.blog/changelog/2026-10-02-unvalidated-npm-trusted-publishing-configurations-now-expire). Those events, and others such as `workflow_run`, run with the repository's rights on input from people outside it. Ludion does not rely on the registry having refused them.

## Decided

npm only, in the three places that compare provenance: gate 2's provenance comparison (judge.ts, `ludion judge` and every npm `ludion patch` candidate), rule 1's same-release exception (time-cap.ts, in the judge and in `ludion patch`'s time cap) and the next fix's same-publisher check (next-fix.ts). Nothing else changes: no gate's numbers, no row of the wait table.

1. **Read.** provenanceFrom also reads the repository id and the event name: from `internalParameters.github` (v1) or `invocation.environment` (v0.2). Either is null when the statement records none. A value that is there but is not a plain number (the id) or a plain lower-case name (the event) makes the read fail, so the judgement is undecidable or the comparison stops, as any failed read does.
2. **The same id.** Where both sides have provenance, each place now also requires the same repository id, besides what it required before (the same repository name and workflow, and for the same-release exception the same commit). Ids that differ stop (the SlugFest shape: the same name and path, another id).
3. **One side only.** When only one of the two statements records a repository id, the two cannot be compared, so it stops.
4. **Neither side.** When neither records one (an older or other format, such as GitLab's, which records no GitHub id), the two are compared as before, and the record says so: gate 2 adds an `info` finding "compared by repository name and workflow, not by ID", the same-release exception's line and receipt entry say it was not compared by ID, and the next fix's publisher check says so in its detail.
5. **The event.** A statement whose event is not `push`, `release` or `workflow_dispatch` stops: in gate 2, for the version an update installs (whatever the version it replaces has); in the same-release exception and the next fix's check, for either side. So does a statement that records a repository id but no event. A statement with neither is not checked for its event (point 4).
6. **Unchanged, for now.** A name that differs with the same id (a rename or a transfer) still stops, as before; whether to let it through is decided separately. Whatever stops today still stops.

What stays true: these are the statement's own claims as the registry stores them. Ludion still does not verify the Sigstore signature or certificate, so the id and the event rest on the registry's checks at publish time, like the repository name already did (the judge's `not_checked` says so). A takeover that publishes from the real repository, by one of the three events, still passes these checks; only the wait and the re-query catch it.

## Undo

A later decision with its own record. Removing the id comparison lets a re-registered repository name pass all three places again.
