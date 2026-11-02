const assert = require("node:assert");
const test = require("node:test");
const _ = require("lodash");

test("lodash chunks a list", () => {
  assert.deepStrictEqual(_.chunk([1, 2, 3], 2), [[1, 2], [3]]);
});
