set -e
cp -a /from/. /to/
for d in /to/*; do echo "$d $(ls $d | wc -l)"; done
