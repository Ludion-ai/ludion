#!/usr/bin/env bash
# Runs on the host with gh only (Git's plumbing read-only, sed, base64): places the built action and the sample in
# ludion-trial. No token goes into a container. Usage: place.sh <folder of build.sh's /out> <log folder>
set -euo pipefail
OUT=$1; LOGS=$2
REPO=Ludion-ai/ludion-trial
BRANCH=ludion-action-3d143fe
FROM=3d143fe2a17bf06d9c03292b3bfe57e1b3178617
W=$(mktemp -d)

blob() { base64 -w0 "$1" > "$W/b64"; gh api "repos/$REPO/git/blobs" -F content=@"$W/b64" -f encoding=base64 --jq .sha; }
entry() { printf '{"path":"%s","mode":"100644","type":"blob","sha":"%s"}' "$1" "$2"; }

# The action: a root commit on its own branch.
items=""
: > "$LOGS/action-blobs.txt"
while read -r file; do
  path=${file#./}
  sha=$(blob "$OUT/action-tree/$path")
  [ "$sha" = "$(git hash-object --no-filters "$OUT/action-tree/$path")" ] || { echo "blob differs: $path"; exit 1; }
  printf '%s %s\n' "$sha" "$path" >> "$LOGS/action-blobs.txt"
  items="$items${items:+,}$(entry "$path" "$sha")"
done < <(tr -d '\r' < "$OUT/action-tree-files.txt")
printf '{"tree":[%s]}' "$items" > "$W/tree.json"
tree=$(gh api "repos/$REPO/git/trees" --input "$W/tree.json" --jq .sha)
cat > "$W/msg" <<EOF
LTRIAL: the action built from Ludion-ai/ludion $FROM

Not a release. See BUILD.md.
EOF
action=$(gh api "repos/$REPO/git/commits" -f tree="$tree" -F message=@"$W/msg" --jq .sha)
gh api "repos/$REPO/git/refs" -f ref="refs/heads/$BRANCH" -f sha="$action" --jq '.ref + " " + .object.sha' | tee "$LOGS/action-branch.txt"

# The workflow: the template with only the differences the definitions list.
{
  echo "# LTRIAL (Ludion-ai/ludion docs/decisions/2026-11-03-ltrial-two-runs.md): action/patch-workflow.yml at $FROM with the action's"
  echo "# pin (branch $BRANCH, built from that commit; not a release), dir, name, and no schedule (workflow_dispatch only)."
  sed -e "s|Ludion-ai/ludion@0000000000000000000000000000000000000000 # a release commit's SHA; none exists yet|Ludion-ai/ludion-trial@$action # branch $BRANCH: built from Ludion-ai/ludion ${FROM:0:7}; not a release|" \
      -e 's|^          dir: \.$|          dir: npm-ltrial|' \
      -e 's|^name: ludion$|name: ludion-ltrial|' \
      -e '/^  schedule:$/d' -e '/^    - cron: "23 \*\/6 \* \* \*"$/d' "$OUT/template/patch-workflow.yml"
} > "$OUT/ludion-ltrial.yml"
diff "$OUT/template/patch-workflow.yml" "$OUT/ludion-ltrial.yml" > "$LOGS/workflow-diff.txt" || true

# Main: one commit that adds the folder and the workflow.
parent=$(gh api "repos/$REPO/commits/main" --jq .sha)
base=$(gh api "repos/$REPO/git/commits/$parent" --jq .tree.sha)
echo "main before: $parent" | tee "$LOGS/main-before.txt"
items=$(entry .github/workflows/ludion-ltrial.yml "$(blob "$OUT/ludion-ltrial.yml")")
while read -r file; do
  path=${file#./}
  sha=$(blob "$OUT/sample/$path")
  [ "$sha" = "$(git hash-object --no-filters "$OUT/sample/$path")" ] || { echo "blob differs: $path"; exit 1; }
  items="$items,$(entry "npm-ltrial/$path" "$sha")"
done < <(tr -d '\r' < "$OUT/sample-files.txt")
printf '{"base_tree":"%s","tree":[%s]}' "$base" "$items" > "$W/tree.json"
tree=$(gh api "repos/$REPO/git/trees" --input "$W/tree.json" --jq .sha)
cat > "$W/msg" <<EOF
LTRIAL: npm-ltrial/ and its workflow

examples/npm-security at Ludion-ai/ludion $FROM, and action/patch-workflow.yml with the action pinned to $action.
EOF
commit=$(gh api "repos/$REPO/git/commits" -f tree="$tree" -f "parents[]=$parent" -F message=@"$W/msg" --jq .sha)
gh api -X PATCH "repos/$REPO/git/refs/heads/main" -f sha="$commit" --jq '.ref + " " + .object.sha' | tee "$LOGS/main-after.txt"
rm -rf "$W"
