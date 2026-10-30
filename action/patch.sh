#!/usr/bin/env bash
# action.yml, mode patch (the validation job: contents: read, no secret, no token): runs `ludion patch --apply` on the
# run's own commit, so each fix that passes is one commit on its own branch, then packs the receipt and a bundle of
# those branches as the ludion-fixes artifact. Candidate code runs only in packages/sandbox's Docker; here only the
# bundled CLI and Git run. A failed fix fails the job after the artifact is uploaded (the last step of this mode).
set -uo pipefail

mkdir -p "$OUT"
result="$RUNNER_TEMP/ludion/patch.json"
node "$CLI" patch --dir "$PROJECT" --apply --json > "$result"
status=$?
echo "status=${status}" >> "$GITHUB_OUTPUT"
if ! node "$CLI" deliver pack --dir "$PROJECT" --result "$result" --out "$OUT"; then
  echo "::error::ludion patch exited ${status} without a receipt to pack. Nothing is uploaded, and no PR is opened."
  exit 1
fi
if [ -f "$OUT/fixes.bundle" ]; then echo "packed=true" >> "$GITHUB_OUTPUT"; else echo "packed=false" >> "$GITHUB_OUTPUT"; fi
{
  echo "**プレビュー：マージは行わない。** Preview: Ludion opens PRs and merges nothing."
  echo
  echo "ludion patch --apply exited ${status}. Each fix (package and outcome); reasons are in the receipt:"
  echo
  jq -r '(.receipt.fixes // (if .receipt then [{package: "php", outcome: .receipt.outcome}] else [] end))[]
    | "- `\(.package | tostring | gsub("[^A-Za-z0-9@._/:~-]"; "?"))`: \(.outcome | tostring | gsub("[^a-z_]"; "?"))"' "$result"
} >> "$GITHUB_STEP_SUMMARY"
