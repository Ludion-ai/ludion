#!/usr/bin/env bash
# LR step 1: the code-search pool (decision 2026-10-30-lr-dockerfile-lag-definitions, section 6.1).
# Writes raw/search-hits.tsv: stratum, query, page, full_name, fork, path.
# Writes raw/search-pages.tsv: stratum, query, page, http outcome, items, total_count.
set -u
here="$(cd "$(dirname "$0")/.." && pwd)"
raw="$here/raw"
hits="$raw/search-hits.tsv"
pages="$raw/search-pages.tsv"
: > "$hits"
: > "$pages"
date -u +%FT%TZ > "$raw/search-started.txt"

queries=()
for v in 7.0 7.1 7.2 7.3 7.4 8.0 8.1 8.2 8.3 8.4 8.5; do
  queries+=("php"$'\t'"\"FROM php:$v\" filename:Dockerfile")
done
for v in $(seq 10 26); do
  queries+=("node"$'\t'"\"FROM node:$v\" filename:Dockerfile")
done

# Code search allows 10 requests a minute; one every 7 seconds stays under it.
for entry in "${queries[@]}"; do
  stratum="${entry%%$'\t'*}"
  q="${entry#*$'\t'}"
  for page in $(seq 1 10); do
    tries=0
    while :; do
      sleep 7
      out="$(gh api -X GET search/code -f q="$q" -f per_page=100 -f page="$page" \
        --jq '"TOTAL\t\(.total_count)\t\(.incomplete_results)", (.items[] | "\(.repository.full_name)\t\(.repository.fork)\t\(.path)")' 2>"$raw/.search-err")"
      rc=$?
      if [ $rc -eq 0 ]; then break; fi
      tries=$((tries + 1))
      err="$(tr '\n' ' ' < "$raw/.search-err")"
      printf '%s\t%s\t%s\terror(try %s): %s\t\t\n' "$stratum" "$q" "$page" "$tries" "$err" >> "$pages"
      if [ $tries -ge 5 ]; then out=""; break; fi
      sleep 60
    done
    [ $rc -eq 0 ] || break
    total="$(printf '%s\n' "$out" | awk -F'\t' '$1=="TOTAL"{print $2"\t"$3}')"
    items="$(printf '%s\n' "$out" | awk -F'\t' '$1!="TOTAL" && NF>=3' )"
    n=0
    if [ -n "$items" ]; then
      n="$(printf '%s\n' "$items" | wc -l | tr -d ' ')"
      printf '%s\n' "$items" | awk -F'\t' -v s="$stratum" -v q="$q" -v p="$page" 'BEGIN{OFS="\t"}{print s,q,p,$1,$2,$3}' >> "$hits"
    fi
    printf '%s\t%s\t%s\tok\t%s\t%s\n' "$stratum" "$q" "$page" "$n" "$total" >> "$pages"
    [ "$n" -lt 100 ] && break
  done
done
rm -f "$raw/.search-err"
date -u +%FT%TZ > "$raw/search-finished.txt"
