#!/usr/bin/env bash
# LR/LR2 step 2: choose 50 php and 50 node repositories, one per owner, and read their files
# (decision 2026-10-30-lr-dockerfile-lag-definitions, sections 2, 5 and 6, and
#  decision 2026-10-31-lr2-definitions, sections 1 to 3).
# Reads raw/search-hits.tsv. Writes:
#   raw/checked.tsv  one row per repository checked, in order, with the outcome (LR's items)
#   raw/froms.tsv    the FROM lines of every file examined (no other file content)
#   raw/lr2.tsv      LR2's items for each chosen repository
# The host only moves base64 text from the GitHub API into scripts/classify.mjs, which runs in
# Docker with no network; no file's text is decoded on the host or written to disk.
set -u
here="$(cd "$(dirname "$0")/.." && pwd)"
raw="$here/raw"
hits="$raw/search-hits.tsv"
checked="$raw/checked.tsv"
froms="$raw/froms.tsv"
lr2="$raw/lr2.tsv"
mdate="$(cut -c1-10 < "$raw/search-started.txt")"
cutoff="$(date -u -d "$mdate - 365 days" +%F)"
want=50
# Docker on Windows takes the Windows spelling of a host path (Git Bash's pwd -W).
repo_root="$(cd "$here/../../.." && pwd -W)"
scripts_win="$(cd "$here/scripts" && pwd -W)"
NODE_IMAGE="node@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c" # node:24-slim

printf 'stratum\tsha256\tfull_name\toutcome\tfork\tarchived\tvisibility\tpushed_at\tstars\tpath\tfrom_line\tdependabot_docker\tdependabot_line\trenovate\trenovate_where\n' > "$checked"
printf 'stratum\tfull_name\tpath\tline_no\tline\n' > "$froms"
printf 'stratum\tfull_name\tread_at\tphp_image\toffline_build\toffline_match\texpose\thealthcheck\ttest_script\ttest_script_detail\ttest_sign\ttest_sign_where\tworkflow_files\tworkflows_read\tdeploy_workflow\tdeploy_workflow_files\tdeploy_platform\tdeploy\tunread\n' > "$lr2"

# The classifier: stdin lines "<id>\t<kind>\t<encoding>\t<base64>", stdout flag lines.
classify() {
  MSYS_NO_PATHCONV=1 docker run --rm -i --network none --read-only --user 1000:1000 \
    --memory 256m --cpus 1 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges \
    -v "$repo_root/packages/cli/src/security/php.ts:/p/php.ts:ro" -v "$scripts_win:/s:ro" \
    "$NODE_IMAGE" node /s/classify.mjs
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

b64_file() { # repo path -> "encoding<TAB>base64" (still encoded)
  api gh api "repos/$1/contents/$(urlenc "$2")" --jq '"\(.encoding // "none")\t\((.content // "") | gsub("\n"; ""))"'
}
listing() { # repo dir -> "type<TAB>name" lines ("" is the root)
  api gh api "repos/$1/contents/$(urlenc "$2")" --jq '.[] | "\(.type)\t\(.name)"'
}
has() { printf '%s\n' "$1" | cut -f2 | grep -qx -- "$2"; }

chosen=" "
owners=" "
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
    lowner="$(printf '%s' "$owner" | tr 'A-Z' 'a-z')"
    case "$lowner" in
      docker-library|nodejs|php|ludion-ai) row "rejected:owner" "" "" "" "" "" "" "" "" "" "" ""; continue ;;
    esac
    case "$chosen" in *" $repo "*) row "rejected:chosen-in-php" "" "" "" "" "" "" "" "" "" "" ""; continue ;; esac
    case "$owners" in *" $lowner "*) row "rejected:owner-already-chosen" "" "" "" "" "" "" "" "" "" "" ""; continue ;; esac
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
    path_found="" line_found="" measured_b64="" unread_hits=0
    while IFS= read -r p; do
      base="$(printf '%s' "${p##*/}" | tr 'A-Z' 'a-z')"
      case "$base" in dockerfile|dockerfile.*|*.dockerfile) ;; *) continue ;; esac
      body="$(b64_file "$repo" "$p")"
      brc=$?
      # a file gone since the search (404) has no qualifying line; any other failure is logged
      if [ $brc -ne 0 ]; then [ $brc -ne 4 ] && unread_hits=$((unread_hits + 1)); continue; fi
      res="$(printf '1\tfrom:%s\t%s\n' "$stratum" "$body" | classify)"
      printf '%s\n' "$res" | LR_P="$p" awk -F'\t' -v s="$stratum" -v r="$repo" '$2=="FROM"{print s"\t"r"\t"ENVIRON["LR_P"]"\t"$3"\t"$4}' >> "$froms"
      last="$(printf '%s\n' "$res" | awk -F'\t' '$2=="QUAL"{print $3}')"
      if [ -n "$last" ]; then path_found="$p"; line_found="$last"; measured_b64="$body"; break; fi
    done < <(awk -F'\t' -v s="$stratum" -v r="$repo" '$1==s && $4==r{print $6}' "$hits" | sort -u)
    if [ -z "$path_found" ]; then
      if [ $unread_hits -gt 0 ]; then m "rejected:no-qualifying-from(unread $unread_hits)"; else m "rejected:no-qualifying-from"; fi
      continue
    fi

    read_at="$(date -u +%FT%TZ)"
    batch="$(printf 'meas\tmeasured\t%s' "$measured_b64")"
    add() { batch+=$'\n'"$1"$'\t'"$2"$'\t'"$3"; }

    # LR section 5: Dependabot docker
    gh_dir="$(listing "$repo" ".github")"; ghrc=$?
    dep="no" dep_fetch=""
    if [ $ghrc -eq 0 ]; then
      for f in dependabot.yml dependabot.yaml; do
        if has "$gh_dir" "$f"; then
          if body="$(b64_file "$repo" ".github/$f")"; then add dep dependabot "$body"; dep_fetch="yes"; else dep="unknown"; fi
          break
        fi
      done
    elif [ $ghrc -ne 4 ]; then dep="unknown"; fi

    # LR section 5: Renovate, by file name first
    ren="no" where="" unread=""
    root="$(listing "$repo" "")" || unread="root"
    for f in renovate.json renovate.json5 .renovaterc .renovaterc.json .renovaterc.json5; do
      has "$root" "$f" && { ren="yes"; where="$f"; break; }
    done
    if [ "$ren" = "no" ]; then
      if [ $ghrc -eq 0 ]; then
        for f in renovate.json renovate.json5; do
          has "$gh_dir" "$f" && { ren="yes"; where=".github/$f"; break; }
        done
      elif [ $ghrc -ne 4 ]; then unread+=" .github"; fi
    fi
    if [ "$ren" = "no" ] && has "$root" ".gitlab"; then
      gl="$(listing "$repo" ".gitlab")" || unread+=" .gitlab"
      for f in renovate.json renovate.json5; do
        has "$gl" "$f" && { ren="yes"; where=".gitlab/$f"; break; }
      done
    fi
    root_pkg=""
    if [ "$ren" = "no" ] && has "$root" "package.json"; then
      if body="$(b64_file "$repo" "package.json")"; then add rpkg package.json "$body"; root_pkg="yes"; else unread+=" package.json"; fi
    fi

    # LR2 section 3.1: the stratum's manifest and test signs, in the Dockerfile's directory and at the root
    l2unread=""
    dir="${path_found%/*}"; [ "$dir" = "$path_found" ] && dir=""
    mname="composer.json"; [ "$stratum" = "node" ] && mname="package.json"
    if [ -n "$dir" ]; then dlist="$(listing "$repo" "$dir")" || l2unread+=" dir-listing"; else dlist="$root"; fi
    [ -n "$unread" ] && case "$unread" in *root*) l2unread+=" root-listing" ;; esac
    if has "$dlist" "$mname"; then
      if body="$(b64_file "$repo" "${dir:+$dir/}$mname")"; then add mdir "$mname" "$body"; else l2unread+=" ${dir:+$dir/}$mname"; fi
    fi
    if [ -n "$dir" ] && has "$root" "$mname"; then
      if body="$(b64_file "$repo" "$mname")"; then add mroot "$mname" "$body"; else l2unread+=" $mname"; fi
    fi
    # The directory comes from a third-party path: it reaches awk only as data (ENVIRON), never as program text.
    signs() { # listing, directory label
      printf '%s\n' "$1" | LR_DIR="$2" awk -F'\t' '{n=tolower($2)} ($1=="dir" && (n=="test"||n=="tests"||n=="__tests__"||n=="spec")) || ($1=="file" && (n=="phpunit.xml"||n=="phpunit.xml.dist"||n=="phpunit.dist.xml")) {printf "%s/%s ", ENVIRON["LR_DIR"], $2}'
    }
    sign_where="$(signs "$dlist" "${dir:-.}"; [ -n "$dir" ] && signs "$root" ".")"
    sign_where="${sign_where% }"

    # LR2 section 3.4: workflows and platform files
    wf_total=0 wf_read=0 wf_unread=0 wf_names=()
    if [ $ghrc -eq 0 ] && has "$gh_dir" "workflows"; then
      wl="$(listing "$repo" ".github/workflows")" || { l2unread+=" workflows-listing"; wl=""; }
      while IFS= read -r w; do
        [ -n "$w" ] && wf_names+=("$w")
      done < <(printf '%s\n' "$wl" | awk -F'\t' '$1=="file" && ($2 ~ /\.yml$/ || $2 ~ /\.yaml$/) {print $2}' | LC_ALL=C sort)
      wf_total=${#wf_names[@]}
      for ((i = 0; i < wf_total && i < 50; i++)); do
        if body="$(b64_file "$repo" ".github/workflows/${wf_names[$i]}")"; then add "wf$i" workflow "$body"; wf_read=$((wf_read + 1)); else wf_unread=$((wf_unread + 1)); fi
      done
    elif [ $ghrc -ne 0 ] && [ $ghrc -ne 4 ]; then l2unread+=" .github-listing"; fi
    platform=""
    for f in vercel.json netlify.toml render.yaml railway.json railway.toml; do has "$root" "$f" && platform+="${platform:+ }$f"; done

    res="$(printf '%s\n' "$batch" | classify)"
    get() { printf '%s\n' "$res" | awk -F'\t' -v id="$1" -v c="$2" '$1==id{print $c; exit}'; }

    # finish LR's Dependabot and Renovate
    if [ "$dep_fetch" = "yes" ]; then
      d="$(get dep 3)"; depline="$(get dep 4)"
      case "$d" in yes) dep="yes" ;; no) ;; *) dep="unknown" ;; esac
    else depline=""; fi
    if [ "$root_pkg" = "yes" ]; then
      case "$(get rpkg 3)" in
        unknown|unreadable) [ "$(get rpkg 4)" = "yes" ] && { ren="yes"; where="package.json"; } || unread+=" package.json" ;;
        *) [ "$(get rpkg 4)" = "yes" ] && { ren="yes"; where="package.json"; } ;;
      esac
    fi
    if [ "$ren" = "no" ] && [ -n "$unread" ]; then ren="unknown"; where="unread:$unread"; fi

    # LR2 items
    php_image="$(get meas 3)"; offline="$(get meas 4)"; offline_match="$(get meas 5)"; expose="$(get meas 6)"; health="$(get meas 7)"
    [ "$php_image" = "unreadable" ] && { php_image="unknown"; offline="unknown"; expose="unknown"; health="unknown"; }
    ts="no" ts_detail=""
    for id in mdir mroot; do
      v="$(get $id 3)"
      [ -z "$v" ] && continue
      ts_detail+="${ts_detail:+ | }$id=$v:$(get $id 5)"
      if [ "$v" = "yes" ]; then ts="yes"; elif [ "$v" != "no" ] && [ "$ts" = "no" ]; then ts="unknown"; fi
    done
    case "$l2unread" in *json*) [ "$ts" = "no" ] && ts="unknown" ;; esac
    if [ "$ts" = "yes" ] || [ -n "$sign_where" ]; then tsign="yes"
    elif [ "$ts" = "unknown" ] || case "$l2unread" in *listing*) true ;; *) false ;; esac; then tsign="unknown"
    else tsign="no"; fi
    dw="no" dw_files=""
    for ((i = 0; i < wf_total && i < 50; i++)); do
      p_="$(get "wf$i" 3)"; d_="$(get "wf$i" 4)"
      if [ "$p_" = "yes" ] && [ "$d_" = "yes" ]; then dw="yes"; dw_files+="${dw_files:+ }${wf_names[$i]}"
      elif [ "$p_" != "yes" ] && [ "$p_" != "no" ]; then wf_unread=$((wf_unread + 1)); fi
    done
    if [ "$dw" = "no" ] && { [ $wf_unread -gt 0 ] || [ $wf_total -gt 50 ] || case "$l2unread" in *workflows-listing*|*.github-listing*) true ;; *) false ;; esac; }; then dw="unknown"; fi
    dp="no"; [ -n "$platform" ] && dp="yes"
    case "$l2unread" in *root-listing*) [ "$dp" = "no" ] && dp="unknown" ;; esac
    if [ "$dw" = "yes" ] || [ "$dp" = "yes" ]; then deploy="yes"; elif [ "$dw" = "unknown" ] || [ "$dp" = "unknown" ]; then deploy="unknown"; else deploy="no"; fi
    [ $wf_unread -gt 0 ] && l2unread+=" workflows:$wf_unread"

    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$stratum" "$repo" "$read_at" \
      "$php_image" "$offline" "$offline_match" "$expose" "$health" "$ts" "$ts_detail" "$tsign" "$sign_where" \
      "$wf_total" "$wf_read" "$dw" "$dw_files" "${platform:-}" "$deploy" "${l2unread# }" >> "$lr2"
    row "selected" "$fork" "$archived" "$vis" "$pushed" "$stars" "$path_found" "$line_found" "$dep" "$depline" "$ren" "$where"
    chosen+="$repo "
    owners+="$lowner "
    n=$((n + 1))
    echo "$stratum $n $repo $read_at" >> "$raw/select.log"
  done < "$raw/order-$stratum.tsv"
done
rm -f "$raw/.err"
date -u +%FT%TZ > "$raw/select-finished.txt"
