# Draft: correction request to the GitHub Advisory Database for @ensdomains/buffer 0.1.1

**Status: draft, not sent.** Prepared for the owner (task L2, cycle 3). Sending it is the owner's decision.

**Channel.** Not confirmed. GHSA-f9pq-63hg-w434 is a malware advisory. Whether its page offers "Suggest improvements for this vulnerability" (which opens a pull request on github/advisory-database) has not been checked. If it does not, GitHub Support is the fallback.

**Propagation.** OSV's MAL-2025-190866 imports this advisory as its `ghsa-malware` origin, and that origin is the only one of three that names 0.1.1. A change on GitHub's side would reach OSV on the next import. If it does not, the same evidence can go to the OpenSSF malicious-packages repository.

**What was checked.** The facts below come from public reads on 2026-10-28, recorded in docs/bench/2026-10-28-cycle2-investigation (`ensdomains-buffer/`) and docs/bench/2026-10-28-backtest-v5 (`malicious-v5.json`, the row for @ensdomains/buffer@0.1.1).

---

**Title:** GHSA-f9pq-63hg-w434: version 0.1.1 of @ensdomains/buffer appears to be a legitimate 2023 release, not the Shai-Hulud 2.0 version

**Advisory:** https://github.com/advisories/GHSA-f9pq-63hg-w434 (Malware in @ensdomains/buffer; published 2025-11-24T17:02:05Z, updated 2025-11-24T17:09:19Z)

**Requested change:** remove `= 0.1.1` from the affected versions, and keep `= 0.1.2`. If 0.1.1 is listed for a reason not visible in public data, please add that reason to the advisory.

**Why.**

1. **0.1.1 was published in 2023, long before the compromise.**
   - The npm registry's `time` field gives 0.1.1 as 2023-02-28T09:46:00.601Z and 0.1.2 as 2025-11-24T05:49:00.347Z.
   - 0.1.1 was published by `makoto_inoue`, a maintainer of the package who had published earlier versions. 0.1.2 was published by `davidchu` with npm 10.8.2.
   - @ensdomains/ens-contracts 0.0.20 (2023-03-01, published by the same maintainer) to 0.0.22 declare `"@ensdomains/buffer": "^0.1.1"`. Until 0.1.2 appeared, that range could only resolve to 0.1.1.

2. **The other sources name only 0.1.2.** In OSV's MAL-2025-190866 (which imports this advisory), amazon-inspector and google-open-source-security list only 0.1.2. Google's entry says the package "was compromised by the Sha1-Hulud: The Second Coming NPM worm". Only the ghsa-malware origin adds 0.1.1.

3. **0.1.1's code is identical to 0.1.0's, and it has no install script.**
   - The registry no longer serves 0.1.1, but two independent archives hold the same 21 files with the same sha256 each:
     - Software Heritage: visit of 2023-03-23, directory `swh:1:dir:3d9e48db08c991644ad0eba0475ca1fbd9ecc047`;
     - jsDelivr: `https://data.jsdelivr.com/v1/packages/npm/@ensdomains/buffer@0.1.1?structure=flat`.
   - Software Heritage's record of the original artifact is `https://registry.npmjs.org/@ensdomains/buffer/-/buffer-0.1.1.tgz`, 284,259 bytes, sha1 `6c275ba7e457e935405b67876f1f0d980c8baa63`.
   - That sha1 equals the registry's `dist.shasum` for 0.1.1. Two copies of the registry's version document record it, with the integrity `sha512-92SfSiNS8XorgU7OUBHo/i1ZU7JV7iz/6bKuLPNVsMxV79/eI7fJR6jfJJc40zAHjs3ha+Xo965Idomlq3rqnw==` and `unpackedSize` 2,096,683, which equals the sum of the archived files' sizes:
     - Software Heritage's replicated npm metadata, discovered 2023-03-23;
     - ecosyste.ms's record, created 2023-02-28 and last updated 2025-11-23, the day before 0.1.2 existed.
   - Compared with 0.1.0's registry tarball (integrity-checked), every `.js` and `.sol` file of 0.1.1 is unchanged. The only differences:
     - `package-lock.json` added;
     - `build/contracts/Buffer.json` and `build/contracts/Migrations.json` removed;
     - `cache/solidity-files-cache.json` (the Solidity compiler cache) changed;
     - `package.json` changed: the version, and `@nomiclabs/hardhat-truffle5` moved from dependencies to devDependencies.
   - 0.1.1's scripts are `test`, `lint`, `build`, `prepublishOnly` and `pub`, with no `preinstall`, `install` or `postinstall`.

4. **The malicious content is only in 0.1.2.** 0.1.2 adds `setup_bun.js` (4,960 bytes) and `bun_environment.js` (10,157,586 bytes), and `"preinstall": "node setup_bun.js"` in package.json. That is the Shai-Hulud 2.0 pattern. 0.1.1 has none of these.

**Why it matters.** The advisory tells anyone with 0.1.1 installed to treat the machine as fully compromised and rotate every secret. Projects that installed @ensdomains/ens-contracts 0.0.20 to 0.0.22 before 2025-11-24 got 0.1.1, the only version in range then. Unless 0.1.1 itself is malicious, the advisory raises a false alarm for each of them.

**Limits of this evidence.** It shows that the archived copies match the registry's recorded hash and contain no new code or install script. It does not show what GitHub's analysts saw when they added 0.1.1, and it cannot rule out a reason that is not in public data. Whether Software Heritage's loader verified the checksum while downloading has not been checked. If 0.1.1 was listed on purpose, a note in the advisory saying why would settle it.
