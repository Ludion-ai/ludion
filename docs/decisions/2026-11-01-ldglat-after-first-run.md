# 2026-11-01 (LDGLAT) — Two readings applied after the scripts' first run, and the endpoint used

This entry records what docs/decisions/2026-11-01-ldglat-definitions.md asks for ("A later change is a new entry with its reason"). It was written after the counts, at the R242 review's suggestion (PR #242, comment 6546018619, N5). It does not edit that entry and changes no number in docs/bench/2026-11-01-ldglat/. The details and the numbers are in docs/bench/2026-11-01-ldglat/summary.md, "Changes after the first run".

- **Bullseye copies are left out (a deviation from section 3 step 3's test).** Two versions contain `deb12u` and have a file in `debian-security`, but end in `~deb11u1`: ca-certificates 20230311+deb12u1~deb11u1 and 20250419~deb12u1~deb11u1, bullseye's copies of bookworm uploads. Section 3 counts versions "uploaded to Debian's security archive for bookworm"; its step 3 test (a file in `debian-security`) alone would have counted them. They were left out as `other-release-upload`, after the first output of analyze.mjs showed them. Effect: fixes in the window 71 → 69; secondary units 8 fewer (all ca-certificates, all reached), with medians that fell or stayed the same; the base-image units and their tag units did not change.
- **`srcfiles` when `allfiles` is 404.** For 7 versions with no binary indexed, snapshot answered 404. The script then read the `.dsc` through `srcfiles`, the fallback section 4 names. None of the 7 was in `debian-security`, so no number changed (the first output is kept as docs/bench/2026-11-01-ldglat/raw/fixes-run1.tsv).
- **The endpoint.** Section 1 names `binfiles` for the binary's files. snapshot.mjs read `/mr/package/<source>/<version>/allfiles?fileinfo=1` instead, which lists the same binary files and the source's files in one answer. The data sent is the same (a source package name and a version). The binary's amd64 or `all` files are chosen from it as section 4 says.

## When it takes effect

It records how the counts in PR #242 were made. It decides nothing further.
