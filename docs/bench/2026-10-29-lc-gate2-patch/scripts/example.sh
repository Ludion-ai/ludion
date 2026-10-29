#!/bin/sh
# Validation only (no --apply) on a copy of examples/npm-security, with the CLI built from this branch.
set -e
rm -rf /tmp/ex && cp -r /w/examples/npm-security /tmp/ex
cd /tmp/ex
node /w/packages/cli/dist/cli.js patch --json > /tmp/out.json || echo "patch exit $?"
node -e 'const r=require("/tmp/out.json"); const t=r.receipt; console.log(JSON.stringify({plan:r.scan.plan, outcome:t&&t.outcome, reason:t&&t.reason, baseline_passed:t&&t.baseline_passed, candidate_passed:t&&t.candidate_passed, changed:t&&t.changed_packages, cap:t&&t.time_cap&&{t:t.time_cap.t,after_t:t.time_cap.after_t,young:t.time_cap.young}, judgement:t&&t.judgement&&{verdict:t.judgement.verdict,urgency:t.judgement.urgency,wait_hours:t.judgement.wait_hours,newest_publish:t.judgement.newest_publish,wait_until:t.judgement.wait_until,fixes:t.judgement.fixes.map(f=>f.id+" "+f.package+" "+f.from+"->"+f.to+" kev="+f.kev+" sev="+f.severity+" epss="+f.epss),findings:t.judgement.findings}}, null, 2))'
cp /tmp/out.json /o/example-out.json
docker image ls --format '{{.Repository}}' | grep -c '^ludion-' || true
