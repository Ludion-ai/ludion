# What `npm pack` puts in ludion-ai

From `npm pack --dry-run --json` in packages/cli, run by `action-check/run.sh` in node:24-slim (image 55fb5f5a527e, `action-check/out/docker-image.txt`; Node v24.22.1, the npm it ships) on a copy of this branch after `npm ci --ignore-scripts` and `npm run build -w ludion-ai`. Raw output: `action-check/out/npm-pack-dry-run.json`, `action-check/out/npm-pack-files.txt`, `action-check/out/run-4.txt`.

| Path in the tarball | Size (bytes) |
| --- | --- |
| package/README.md | 9785 |
| package/dist/cli.js | 438457 |
| package/package.json | 772 |

- name `ludion-ai`, version `0.3.0-preview.1`, 3 files, `bundled: []`
- package size 103455 bytes, unpacked 449014 bytes
- shasum `6ff164d9ae89cfbbddc7ac93330f1ac41cc428d8`
- integrity `sha512-tv69FMIYq9x/dFEytZzGwlh9srLj6Mu2+WlKuy3G+0z4RrSGvu6VI7Vs0wWBGA3HoMTZdopTH7aLTKXRsYWm3A==`
- sha256 of dist/cli.js: `7a9adf10833ebe54acbc66ff3bf71edb45bf4d351200da0f5bf0b8f4ffcbd384`, the same in all four builds of this session (`run-1.txt` to `run-4.txt`; action/dist/record.js was `0cfdb12da1bb25659b26382ed02a5086c00a49f821db7de0fd661e7f3c8d0234` in all four). Only README.md changed between them, which is not in either bundle

These are the three files publish.yml's Pack step expects. The tarball's integrity is not reproducible from this list alone: the file modes were 493 (0755) because the copy came from a Windows checkout, and publish.yml packs on Linux. The tarball that counts is the one publish.yml builds.

`files` in packages/cli/package.json is now `["dist/cli.js", "README.md"]` instead of `["dist", "README.md"]`. Before, anything else that a build wrote into dist/ would have been published; now only the bundle is.

## Again after LP-rest (2026-10-29)

The section above is from run.sh at 75622bd (outputs in `action-check/out/`). LP-rest added LICENSE to the package, raised the floor to Node 22 and made the build set the packed files to 0644 (docs/decisions/2026-10-29-lp-rest-followups.md). From `action-check/run.sh` at 6accc4602eb7aa2ed94490f79e8cfca2ce3f64f8, in node:24-slim (sha256:55fb5f5a527e…, `action-check/out-2026-10-29/docker-image.txt`; Node v24.22.1), on a `git archive` of that commit after `npm ci --ignore-scripts` and `npm run build -w ludion-ai`. Raw output: `action-check/out-2026-10-29/` (`npm-pack-dry-run.json`, `npm-pack-files.txt`, `npm-pack-modes.txt`, `npm-pack-tarballs-sha256.txt`, `run.txt`).

| Path in the tarball | Size (bytes) | Mode |
| --- | --- | --- |
| package/LICENSE | 11358 | 420 (0644) |
| package/README.md | 9937 | 420 (0644) |
| package/dist/cli.js | 472134 | 420 (0644) |
| package/package.json | 787 | 420 (0644) |

- 4 files, `bundled: []`; package size 118167 bytes, unpacked 494216 bytes
- shasum `9d3c25dd163d2ee5ca28c7613e4b42fef62c845d`
- integrity `sha512-MRftccSPHyERDkLTvoHATNEN4urNxE959ER4TfPiPEYy4jsq4sQXiVRTrhve/gzMWuu7HtkzlMqq4Fwqinidsw==`
- **The same bytes from executable files.** run.sh then set the four files to 0755 (as a copy from a Windows checkout has them), built again and packed again: the tarball's sha256 was `9f3cfb02f204894b03cad89155675929988ba8ac7efa3a95c5690c2c8fa3c50d` both times, and the integrity the same. This shows that the build's modes, not the checkout's, decide the bytes. Whether publish.yml's tarball on GitHub's runner has these bytes depends also on its npm version and the build's output; that was not checked.
- sha256 of dist/cli.js `bccbfd457d84af934defeacd9502fb4e9ceef40cad6c73368ff28abef8651d70`, action/dist/record.js `dd9ae6d6089ba3f731a23f1280ddd6198c7c0f78d4ac01c1e4266308f40a18a8` (`bundle-sha256.txt`). Both changed from the section above: record.ts changed in #166, and both bundles now target Node 22.
- **publish.yml still expects three files.** Its Pack step compares the tarball with README.md, dist/cli.js and package.json, so with LICENSE it fails before staging, and nothing is published, until `package/LICENSE` is added to that list. publish.yml is a protected path and was not changed here.
