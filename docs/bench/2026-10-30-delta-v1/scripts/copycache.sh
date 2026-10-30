# Copies v5's cached archive answers into this lane's cache volume: JSON lists and metadata, plus (in swh/) the raw
# package.json text of the versions Software Heritage held for v5 (README, "One exception in the cache").
set -e
for d in ecosystems jsdelivr swh; do mkdir -p /to/$d; cp -a /from/$d/. /to/$d/; echo "$d $(ls /to/$d | wc -l)"; done
