#!/usr/bin/env bash
# LR step 2: choose 50 php and 50 node repositories and read their configuration
# (decision 2026-10-30-lr-dockerfile-lag-definitions, sections 2, 5 and 6).
# Reads raw/search-hits.tsv. Writes:
#   raw/checked.tsv  one row per repository checked, in order, with the outcome
#   raw/froms.tsv    the FROM lines of every file examined (no other file content)
# File contents are streamed through grep and never saved.
set -u
here="$(cd "$(dirname "$0")/.." && pwd)"
raw="$here/raw"
hits="$raw/search-hits.tsv"
checked="$raw/checked.tsv"
froms="$raw/froms.tsv"
mdate="$(cut -c1-10 < "$raw/search-started.txt")"
cutoff="$(date -u -d "$mdate - 365 days" +%F)"
want=50

printf 'stratum\tsha256\tfull_name\toutcome\tfork\tarchived\tvisibility\tpushed_at\tstars\tpath\tfrom_line\tdependabot_docker\tdependabot_line\trenovate\trenovate_where\n' > "$checked"
printf 'stratum\tfull_name\tpath\tline_no\tline\n' > "$froms"

# FROM [--platform=x] [prefix](php|node):X.Y.Z[-variant][@sha256:<64 hex>] [AS name]
qualifies() { # $1 image name
  grep -E "^[[:space:]]*[Ff][Rr][Oo][Mm][[:space:]]+(--platform=[^[:space:]]+[[:space:]]+)?(docker\.io/library/|index\.docker\.io/library/|docker\.io/|library/)?$1:[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9._-]+)?(@sha256:[0-9a-f]{64})?([[:space:]]+[Aa][Ss][[:space:]]+[^[:space:]]+)?[[:space:]]*\$"
}

urlenc() { # percent-encode a path, keeping / and unreserved characters
  local LC_ALL=C
  local s="$1" out="" c i
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    case "$c" in
      [A-Za-z0-9._~/-]) out+="$c" ;;
      *) out+="$(printf '%%%02X' "'$c")" ;;
    esac
  done
  printf '%s' "$out"
}

# gh api with waiting on the rate limit. Prints the body; returns 0 ok, 4 not found, 1 other.
api() {
  local tries=0 rc err
  while :; do
    "$@" 2>"$raw/.err"
    rc=$?
    [ $rc -eq 0 ] && return 0
    err="$(tr '\n' ' ' < "$raw/.err")"
    case "$err" in
      *"HTTP 404"*) return 4 ;;
      *"rate limit"*|*"HTTP 403"*|*"HTTP 429"*|*"HTTP 5"*)
        tries=$((tries + 1))
        echo "wait after: $err" >> "$raw/select.log"
        [ $tries -ge 5 ] && return 1
        sleep 120 ;;
      *) echo "error: $* :: $err" >> "$raw/select.log"; return 1 ;;
    esac
  done
}

raw_file() { # repo path -> content on stdout
  api gh api -H "Accept: application/vnd.github.raw" "repos/$1/contents/$(urlenc "$2")"
}

chosen=" "
for stratum in php node; do
  n=0
  # unique repositories of the stratum in ascending SHA-256 of the lower-case name
  awk -F'\t' -v s="$stratum" '$1==s{print $4}' "$hits" | sort -u | while read -r repo; do
    printf '%s\t%s\n' "$(printf '%s' "$repo" | tr 'A-Z' 'a-z' | sha256sum | cut -c1-64)" "$repo"
  done | sort > "$raw/order-$stratum.tsv"

  while IFS=$'\t' read -r h repo; do
    [ $n -ge $want ] && break
    row() { printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$stratum" "$h" "$repo" "$@" >> "$checked"; }
    owner="${repo%%/*}"
    case "$(printf '%s' "$owner" | tr 'A-Z' 'a-z')" in
      docker-library|nodejs|php|ludion-ai) row "rejected:owner" "" "" "" "" "" "" "" "" "" "" ""; continue ;;
    esac
    case "$chosen" in *" $repo "*) row "rejected:chosen-in-php" "" "" "" "" "" "" "" "" "" "" ""; continue ;; esac
    meta="$(api gh api "repos/$repo" --jq '"\(.fork)\t\(.archived)\t\(.visibility)\t\(.pushed_at)\t\(.stargazers_count)\t\(.private)"')"
    rc=$?
    if [ $rc -ne 0 ]; then row "rejected:metadata-unreadable($rc)" "" "" "" "" "" "" "" "" "" "" ""; continue; fi
    IFS=$'\t' read -r fork archived vis pushed stars private <<< "$meta"
    m() { row "$1" "$fork" "$archived" "$vis" "$pushed" "$stars" "" "" "" "" "" ""; }
    if [ "$private" != "false" ]; then m "rejected:not-public"; continue; fi
    if [ "$fork" != "false" ]; then m "rejected:fork"; continue; fi
    if [ "$archived" != "false" ]; then m "rejected:archived"; continue; fi
    if [[ "$pushed" < "$cutoff" ]]; then m "rejected:pushed-before-$cutoff"; continue; fi

    # hit files with an accepted base name, in ascending path order
    path_found="" line_found=""
    while IFS= read -r p; do
      base="$(printf '%s' "${p##*/}" | tr 'A-Z' 'a-z')"
      case "$base" in dockerfile|dockerfile.*|*.dockerfile) ;; *) continue ;; esac
      content_froms="$(raw_file "$repo" "$p" | tr -d '\r' | grep -nE '^[[:space:]]*[Ff][Rr][Oo][Mm][[:space:]]')"
      printf '%s\n' "$content_froms" | awk -F: -v s="$stratum" -v r="$repo" -v p="$p" 'NF>1{n=$1; sub(/^[0-9]+:/, ""); gsub(/\t/, " "); print s"\t"r"\t"p"\t"n"\t"$0}' >> "$froms"
      last="$(printf '%s\n' "$content_froms" | sed 's/^[0-9]*://' | qualifies "$stratum" | tail -n 1)"
      if [ -n "$last" ]; then path_found="$p"; line_found="$(printf '%s' "$last" | tr '\t' ' ')"; break; fi
    done < <(awk -F'\t' -v s="$stratum" -v r="$repo" '$1==s && $4==r{print $6}' "$hits" | sort -u)
    if [ -z "$path_found" ]; then m "rejected:no-qualifying-from"; continue; fi

    # Dependabot docker
    gh_dir="$(api gh api "repos/$repo/contents/.github" --jq '.[].name')"; ghrc=$?
    dep="no" depline=""
    if [ $ghrc -eq 0 ]; then
      for f in dependabot.yml dependabot.yaml; do
        if printf '%s\n' "$gh_dir" | grep -qx "$f"; then
          body="$(raw_file "$repo" ".github/$f")"
          if [ $? -ne 0 ]; then dep="unknown"; break; fi
          depline="$(printf '%s\n' "$body" | tr -d '\r' | grep -iE "package-ecosystem:[[:space:]]*[\"']?docker[\"']?[[:space:]]*(#.*)?\$" | head -n 1 | sed 's/^[[:space:]]*//')"
          [ -n "$depline" ] && dep="yes"
          break
        fi
      done
    elif [ $ghrc -ne 4 ]; then dep="unknown"; fi

    # Renovate: "yes" as soon as one location has it; "unknown" when a location
    # could not be read and none had it.
    ren="no" where="" unread=""
    root="$(api gh api "repos/$repo/contents/" --jq '.[].name')" || unread="root"
    for f in renovate.json renovate.json5 .renovaterc .renovaterc.json .renovaterc.json5; do
      printf '%s\n' "$root" | grep -qx -- "$f" && { ren="yes"; where="$f"; break; }
    done
    if [ "$ren" = "no" ]; then
      if [ $ghrc -eq 0 ]; then
        for f in renovate.json renovate.json5; do
          printf '%s\n' "$gh_dir" | grep -qx -- "$f" && { ren="yes"; where=".github/$f"; break; }
        done
      elif [ $ghrc -ne 4 ]; then unread+=" .github"; fi
    fi
    if [ "$ren" = "no" ] && printf '%s\n' "$root" | grep -qx ".gitlab"; then
      gl="$(api gh api "repos/$repo/contents/.gitlab" --jq '.[].name')" || unread+=" .gitlab"
      for f in renovate.json renovate.json5; do
        printf '%s\n' "$gl" | grep -qx -- "$f" && { ren="yes"; where=".gitlab/$f"; break; }
      done
    fi
    if [ "$ren" = "no" ] && printf '%s\n' "$root" | grep -qx "package.json"; then
      pj="$(raw_file "$repo" "package.json")"
      if [ $? -ne 0 ]; then unread+=" package.json"
      elif printf '%s\n' "$pj" | grep -qE '^[[:space:]]*"renovate"[[:space:]]*:'; then ren="yes"; where="package.json"; fi
    fi
    if [ "$ren" = "no" ] && [ -n "$unread" ]; then ren="unknown"; where="unread:$unread"; fi

    row "selected" "$fork" "$archived" "$vis" "$pushed" "$stars" "$path_found" "$line_found" "$dep" "$depline" "$ren" "$where"
    chosen+="$repo "
    n=$((n + 1))
    echo "$stratum $n $repo" >> "$raw/select.log"
  done < "$raw/order-$stratum.tsv"
done
rm -f "$raw/.err"
date -u +%FT%TZ > "$raw/select-finished.txt"
