# What `npm pack` puts in ludion-ai

From `npm pack --dry-run --json` in packages/cli, run by `action-check/run.sh` in node:24-slim (image 55fb5f5a527e, `action-check/out/docker-image.txt`; Node v24.22.1, the npm it ships) on a copy of this branch after `npm ci --ignore-scripts` and `npm run build -w ludion-ai`. Raw output: `action-check/out/npm-pack-dry-run.json`, `action-check/out/npm-pack-files.txt`, `action-check/out/run-3.txt`.

| Path in the tarball | Size (bytes) |
| --- | --- |
| package/README.md | 9277 |
| package/dist/cli.js | 438457 |
| package/package.json | 772 |

- name `ludion-ai`, version `0.3.0-preview.1`, 3 files, `bundled: []`
- package size 103266 bytes, unpacked 448506 bytes
- shasum `38b44952ebb5fc4868b25491a998e8166ddf58c2`
- integrity `sha512-jbNuhahcTWsx4qPyE1wMq6LqlXeboUIJTS+TWLdMuYy70CRj3WLD3y0iJYoLx5CQRYMjaoqXgJ+eWMT5uiMrEw==`
- sha256 of dist/cli.js: `7a9adf10833ebe54acbc66ff3bf71edb45bf4d351200da0f5bf0b8f4ffcbd384`, the same in all three builds of this session (`run-1.txt`, `run-2.txt`, `run-3.txt`; action/dist/record.js was `0cfdb12da1bb25659b26382ed02a5086c00a49f821db7de0fd661e7f3c8d0234` in all three)

These are the three files publish.yml's Pack step expects. The tarball's integrity is not reproducible from this list alone: the file modes were 493 (0755) because the copy came from a Windows checkout, and publish.yml packs on Linux. The tarball that counts is the one publish.yml builds.

`files` in packages/cli/package.json is now `["dist/cli.js", "README.md"]` instead of `["dist", "README.md"]`. Before, anything else that a build wrote into dist/ would have been published; now only the bundle is.
