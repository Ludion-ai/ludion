// Own harmless probes only, never lesson code. Exercise the real Docker execution and package-install paths.
import assert from "node:assert/strict";
import { pullImages, runInDocker, type RunSpec } from "./verify/src/docker.ts";

const nodeProbe = `
const fs = require('node:fs');
const assert = require('node:assert/strict');
const status = fs.readFileSync('/proc/self/status', 'utf8');
assert.match(status, /^CapEff:\\s+0+$/m);
assert.match(status, /^NoNewPrivs:\\s+1$/m);
assert.notEqual(process.getuid(), 0);
assert.deepEqual(fs.readdirSync('/sys/class/net'), ['lo']);
fs.writeFileSync('/tmp/ludion-probe', 'own harmless probe');
assert.throws(() => fs.writeFileSync('/ludion-probe', 'own harmless probe'), { code: 'EROFS' });
if (process.env.LUDION_PACKAGES) assert.equal(require('is-number')(1), true);
console.log('node: capabilities dropped, no privilege gain, non-root, network off, read-only root, tmp writable');
`;
const pythonProbe = `
import errno, os, re
from pathlib import Path
status = Path('/proc/self/status').read_text()
assert re.search(r'^CapEff:\\s+0+$', status, re.M)
assert re.search(r'^NoNewPrivs:\\s+1$', status, re.M)
assert os.getuid() != 0
assert os.listdir('/sys/class/net') == ['lo']
Path('/tmp/ludion-probe').write_text('own harmless probe')
try:
    Path('/ludion-probe').write_text('own harmless probe')
except OSError as error:
    assert error.errno == errno.EROFS, error
else:
    raise AssertionError('root filesystem writable')
if os.getenv('LUDION_PACKAGES'):
    from packaging.version import Version
    assert Version('1.0') < Version('2.0')
print('python: capabilities dropped, no privilege gain, non-root, network off, read-only root, tmp writable')
`;
assert.equal(process.platform, "linux", "Run the sandbox smoke on the Linux CI runner with Docker installed.");
assert.deepEqual(pullImages(["node@24", "python@3.14"]), []);
const specs: RunSpec[] = [
  { runtime: "node@24", code: nodeProbe },
  { runtime: "node@24", code: nodeProbe, packages: { "is-number": "7.0.0" } },
  { runtime: "python@3.14", code: pythonProbe },
  { runtime: "python@3.14", code: pythonProbe, packages: { packaging: "25.0" } },
];
for (const spec of specs) {
  const result = await runInDocker(spec);
  if (result.kind !== "done") throw new Error(result.reason);
  assert.equal(result.timedOut, false, JSON.stringify(result));
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  console.log(`${spec.runtime} (${spec.packages ? 'with pinned packages' : 'without packages'}): ${result.stdout.trim()}`);
}
