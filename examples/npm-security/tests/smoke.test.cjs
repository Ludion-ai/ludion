const { test } = require('node:test');
const assert = require('node:assert/strict');
const lodash = require('lodash');
test('application response keeps nested values and escapes user-facing text', () => {
  assert.equal(lodash.get({ customer: { name: 'Ludion' } }, 'customer.name'), 'Ludion');
  assert.equal(lodash.escape('<script>日本語</script>'), '&lt;script&gt;日本語&lt;/script&gt;');
  assert.deepEqual(lodash.merge({ a: { b: 1 } }, { a: { c: 2 } }), { a: { b: 1, c: 2 } });
});
