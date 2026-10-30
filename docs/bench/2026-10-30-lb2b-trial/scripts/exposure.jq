# LB2b item 8 (definitions.md): exposure time from Ludion's PRs, read only.
# Input: the JSON array from `gh api --paginate --slurp 'repos/<owner>/<repo>/pulls?state=all&per_page=100'`
# (pages slurped into one array of arrays), saved by the host; no token goes into the container that runs this.
# Run, from this folder: docker run --rm -i --memory 128m -v "$PWD:/s:ro" ghcr.io/jqlang/jq:1.7.1 -f /s/exposure.jq < pulls.json
# For each PR whose body starts with <!-- ludion-fix -->: the body's "Fix published" time, created_at, merged_at,
# and published→PR and PR→merge in hours (null when a time is unknown or the PR is not merged).
def hours($from; $to): if $from == null or $to == null then null
  else ((($to | fromdateiso8601) - ($from | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)) / 3600 * 100 | round / 100) end;

[ flatten[]
  | select((.body // "") | startswith("<!-- ludion-fix -->"))
  | ([ .body | capture("\\| Fix published \\| `(?<t>[0-9T:.Z-]+)`") ] | first | .t) as $published
  | {
      number, head: .head.ref, state,
      fix_published_at: $published,
      created_at, merged_at,
      published_to_pr_hours: hours($published; .created_at),
      pr_to_merge_hours: hours(.created_at; .merged_at)
    } ]
