"use strict";
const assert = require("node:assert/strict");
const { responseFor } = require("../src/response.js");

for (const [path, expected] of [
  ["/health", { code: 200, body: { status: "ok" } }],
  ["/", { code: 200, body: { message: "Hello from Ludion", encoding: "日本語" } }],
  ["/missing", { code: 404, body: { error: "not_found" } }],
]) {
  const actual = responseFor(path);
  assert.deepEqual(actual, expected, `Response contract failed: ${path}`);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, `JSON contract failed: ${path}`);
}
console.log("Response and JSON contracts passed.");
