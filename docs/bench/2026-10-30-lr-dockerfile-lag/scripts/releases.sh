#!/usr/bin/env bash
# LR: the official release lists (decision 2026-10-30-lr-dockerfile-lag-definitions, section 3).
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
rel="$here/raw/releases"
mkdir -p "$rel"
for v in 5 7 8; do
  curl -fsS "https://www.php.net/releases/index.php?json&version=$v&max=1000" -o "$rel/php-$v.json"
done
curl -fsS "https://www.php.net/releases/states.php" -o "$rel/php-states.json"
curl -fsS "https://nodejs.org/dist/index.json" -o "$rel/node-index.json"
curl -fsS "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json" -o "$rel/node-schedule.json"
date -u +%FT%TZ > "$rel/fetched-at.txt"
