#!/bin/sh
# Each mutation changes the copy in this volume only, runs water.spec, and restores it.
cd /w || exit 9
SRC=/w/_le2e/e2e.orig
rm -rf "$SRC" /w/_le2e/dist.orig; cp -r e2e "$SRC"; cp -r apps/site/dist /w/_le2e/dist.orig
restore() { cp "$SRC"/*.ts e2e/; rm -rf apps/site/dist; cp -r /w/_le2e/dist.orig apps/site/dist; }
result() { name=$1; node /w/_le2e/report.mjs "$name" each | grep -E 'water.spec.ts:[0-9]+ text' | sed 's/^water.spec.ts:[0-9]* //' > "/w/_le2e/out/$name/result.txt"; echo "== $name"; cat "/w/_le2e/out/$name/result.txt"; grep -E 'Error: |Received array|text whose|^ +\+ +"' "/w/_le2e/out/$name/log.txt" | cut -c1-120 | sort | uniq -c | sort -rn | head -12; }

# M1: a threshold of 5.1 catches a box only at an added moment on /ja/ dark (5.0903; 5.1212 at the steady moments).
sed -i 's/export const SMALL_TEXT_MIN = 4.5;/export const SMALL_TEXT_MIN = 5.1;/' e2e/water-contrast.ts
sh /w/_le2e/run.sh m1-threshold e2e/water.spec.ts; result m1-threshold; restore

# M2: the same threshold without the added moments.
sed -i 's/export const SMALL_TEXT_MIN = 4.5;/export const SMALL_TEXT_MIN = 5.1;/; s/"\/ja\/": \[32878, 64812\]/"\/ja\/": []/' e2e/water-contrast.ts
sh /w/_le2e/run.sh m2-no-added e2e/water.spec.ts; result m2-no-added; restore

# M3: the dark water's peak raised in the built site.
grep -l 'peak:.045' apps/site/dist/_astro/*.js | while read -r f; do sed -i 's/peak:\.045/peak:.6/' "$f"; echo "patched $f"; done
sh /w/_le2e/run.sh m3-dark-peak e2e/water.spec.ts; result m3-dark-peak; restore

# M4: the light water's tint darkened in the built site.
grep -l '#eeeeee' apps/site/dist/_astro/*.js | while read -r f; do sed -i 's/#eeeeee/#555555/' "$f"; echo "patched $f"; done
sh /w/_le2e/run.sh m4-light-tint e2e/water.spec.ts; result m4-light-tint; restore

# M5: the clock no longer moves the water.
sed -i 's/await page.clock.fastForward(moment - now);/await page.clock.fastForward(0);/' e2e/water.spec.ts
sh /w/_le2e/run.sh m5-frozen e2e/water.spec.ts; result m5-frozen; restore

diff -r "$SRC" e2e && diff -r /w/_le2e/dist.orig apps/site/dist && echo restored
