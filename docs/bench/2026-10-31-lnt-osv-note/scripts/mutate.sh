#!/bin/sh
# LNT mutations: each one changes a copy in the Docker volume, runs packages/cli/test/osv-note.test.ts, and restores.
cd /w || exit 1
OSV=packages/cli/src/security/osv.ts
ACQ=packages/cli/src/security/acquisition.ts
JUDGE=packages/cli/src/security/judge.ts
run() {
  name="$1"; shift
  cp "$OSV" /tmp/osv.bak; cp "$ACQ" /tmp/acq.bak; cp "$JUDGE" /tmp/judge.bak
  "$@"
  if git diff --quiet -- "$OSV" "$ACQ" "$JUDGE"; then echo "$name: NOT APPLIED"; else
    if npx vitest run packages/cli/test/osv-note.test.ts --maxWorkers=2 > "/tmp/$name.log" 2>&1; then echo "$name: SURVIVED (tests pass)"; else echo "$name: CAUGHT ($(grep -c '×' "/tmp/$name.log") failing)"; grep '×' "/tmp/$name.log" | sed 's/\x1b\[[0-9;]*m//g'; fi
  fi
  cp /tmp/osv.bak "$OSV"; cp /tmp/acq.bak "$ACQ"; cp /tmp/judge.bak "$JUDGE"
}
m1() { sed -i 's/ (www.cisa.gov)//' "$OSV"; }
m2() { echo '// see https://example.net/' >> "$JUDGE"; }
m3() { sed -i '/"bitbucket.org": new RegExp/d' "$ACQ"; }
m4() { sed -i 's/note: SCAN_NOTE }/note: "Package names and versions are sent to OSV, and Composer package names to Packagist; source is not." }/' "$OSV"; }
m5() { sed -i 's/`ludion deliver open` pushes each fix.s commit to the project.s own GitHub repository and opens its PR there; //' "$OSV"; }
m6() { sed -i 's#https://repo.maven.apache.org#https://repo1.maven.org#' "$ACQ"; }
m7() { sed -i 's/registry.npmjs.org)/the registry)/' "$OSV"; }
# M8 is main's note before this change, put back as SCAN_NOTE.
m8() { sed -i 's/^export const SCAN_NOTE = .*$/export const SCAN_NOTE = "Known advisories for the recorded package inventory only. No match is not a security guarantee. Package names and versions are sent to OSV, and Composer package names to Packagist; source is not. Major-version fixes, unresolved inventory and unsupported builds require review.";/' "$OSV"; }
run M1-note-drops-cisa m1
run M2-new-host-in-code m2
run M3-archive-host-removed m3
run M4-scan-returns-old-note m4
run M5-note-drops-github m5
run M6-maven-mirror-changed m6
run M7-note-drops-npm-registry m7
run M8-main-note-before-lnt m8
echo "after restore:"; git status --short
