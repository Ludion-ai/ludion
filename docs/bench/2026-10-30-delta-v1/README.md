# Delta v1: counts (2026-10-30, lane LD)

The result file is `delta-v1.json` in this folder. Every number below is copied from it; the line numbers are its lines.

## Malicious versions

- 1,148 malicious versions (`"pairs": 1148`, line 50).
- 11 of them were obtained: 9 flagged (`"flagged": 9`, line 52) and 2 clean, that is, missed (`"clean": 2`, line 53).
- The 2 missed:
  - @ensdomains/buffer 0.1.1 (row with `"name"` on line 10506). It is disputed in v5 (`docs/bench/2026-10-28-backtest-v5/README.md`, lines 140 and 146).
  - @react-native-aria/switch 0.2.5 (row with `"name"` on line 691).

## Genuine fixes

- 192 genuine fixes were obtained (`"registry / registry": 192`, line 215), of 200 pairs (`"pairs": 200`, line 203).
- 51 of the 192 were flagged as having a new capability (`"flagged": 51`, line 206). 51 / 192 = 26.56%.
- 15 of the 51 are vite (rows with `"name": "vite"` and `"status": "flagged"`, on lines 1770, 2511, 3878, 4569, 4688, 4918, 5864, 6094, 6816, 7785, 7955, 8289, 8751, 9734 and 9853).
  - In 14 of the 15, every path in the row's `where` is a chunk with a content-hash name (`dist/node/chunks/dep-<8 characters>.js`).
  - In the other one, vite 7.1.10 → 7.1.11 (line 5864), the paths in `where` (lines 5927–5966) are `dist/node/chunks/build2.js` and `dist/node/chunks/config.js`, names with no hash.

## Conclusion

Because there is no data for the removed versions, the diff check cannot be verified on past malicious versions.
