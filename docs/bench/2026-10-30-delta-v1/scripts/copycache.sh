# Copies v5's cached archive answers (JSON lists and metadata, no package files) into this lane's cache volume.
set -e
for d in ecosystems jsdelivr swh; do mkdir -p /to/$d; cp -a /from/$d/. /to/$d/; echo "$d $(ls /to/$d | wc -l)"; done
