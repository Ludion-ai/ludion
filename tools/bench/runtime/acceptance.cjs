// Runs only inside Docker. 'input' is serialized data from runtime-tasks.ts, never host-evaluated candidate code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const versions = { node: process.versions.node, vitest: require('/w/node_modules/vitest/package.json').version, vite: require('/w/node_modules/vite/package.json').version };
assert.equal(versions.vitest, '5.0.3');
assert.equal(versions.vite, '7.3.1');
const root = '/tmp/candidate';
fs.mkdirSync(root);
for (const [name, text] of Object.entries(input.files)) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}
fs.symlinkSync('/w/node_modules', path.join(root, 'node_modules'));
for (const [name, text] of Object.entries(input.immutable)) {
  assert.equal(input.files[name], text, `${name} must remain unchanged for this focused task`);
}
const observations = [];
const env = { ...process.env, PATH: `/w/node_modules/.bin:${process.env.PATH}`, CI: 'true', NO_COLOR: '1' };
function execute(label, script) {
  const output = `/tmp/report-${observations.length}.json`;
  const result = script
    ? spawnSync('npm', ['run', script, '--', '--reporter=json', `--outputFile=${output}`, '--maxWorkers=1'], { cwd: root, env, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 })
    : spawnSync(process.execPath, ['/w/node_modules/vitest/vitest.mjs', 'run', 'src/convert.test.js', '--reporter=json', `--outputFile=${output}`, '--maxWorkers=1'], { cwd: root, env, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
  if (result.error) { console.error(`${label}: subprocess error: ${result.error.message}`); process.exit(2); }
  assert.ok(fs.existsSync(output), `${label}: no Vitest JSON report; ${result.stderr.slice(-1000)}`);
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  const tests = report.testResults.flatMap((suite) => suite.assertionResults);
  const named = (t) => [...t.ancestorTitles, t.title].join(' > ');
  const passed = tests.filter((t) => t.status === 'passed').map(named).sort();
  const failed = tests.filter((t) => t.status === 'failed').map(named).sort();
  observations.push({ label, exit_code: result.status, passed, failed });
  return { status: result.status, passed, failed };
}
if (input.id === 'vitest-5-0-0-13-c') {
  const tests = path.join(root, 'src/cart.test.js');
  // The prompt explicitly requires selecting tests added to this suite later, and excluding wishlist's suite.
  fs.appendFileSync(tests, `\ndescribe('cart', () => { describe('checkout', () => { test('handles a future checkout case', () => { expect(checkout({ items: [{price: 4, qty: 2}] }).charged).toBe(8); }); }); });\n`);
  const result = execute('checkout selection including a future case', 'test:checkout');
  assert.equal(result.status, 0);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.passed, [
    'cart > checkout > charges the total',
    'cart > checkout > handles a future checkout case',
    'cart > checkout > rejects an empty cart',
  ]);
} else if (input.id === 'vitest-5-0-0-16-c') {
  const originalNames = ['convert > converts with the current rate', 'convert > rejects unknown currencies'];
  const healthy = execute('healthy implementation');
  assert.equal(healthy.status, 0);
  assert.deepEqual(healthy.failed, []);
  assert.equal(healthy.passed.length, 3, 'Keep both original tests and actually execute the new rejection test');
  for (const name of originalNames) assert.ok(healthy.passed.includes(name), `Missing original test: ${name}`);
  const newTest = healthy.passed.find((name) => !originalNames.includes(name));
  const source = path.join(root, 'src/convert.js');
  const original = fs.readFileSync(source, 'utf8');
  const mutations = [
    ['swallowed fetch failure', "throw new Error('Exchange rates are unavailable, try again later', { cause });", 'return 0;', newTest],
    ['wrong availability error message', "throw new Error('Exchange rates are unavailable, try again later', { cause });", "throw new Error('wrong availability message');", newTest],
    ['broken currency conversion', 'return Math.round(amount * rates[to] * 100) / 100;', 'return 0;', originalNames[0]],
    ['broken unknown currency error', 'throw new Error(`Unknown currency: ${to}`);', "throw new Error('wrong currency message');", originalNames[1]],
  ];
  for (const [label, from, to, expected] of mutations) {
    assert.ok(original.includes(from), `Harness mutation not applicable: ${label}`);
    fs.writeFileSync(source, original.replace(from, to));
    const result = execute(label);
    assert.notEqual(result.status, 0, `${label} must be detected`);
    assert.deepEqual(result.failed, [expected], `${label} should fail its relevant assertion, not unrelated startup`);
    fs.writeFileSync(source, original);
  }
} else throw new Error('Unsupported task');
console.log(`LUDION_ACCEPTANCE=${JSON.stringify({ id: input.id, passed: true, versions, observations })}`);
