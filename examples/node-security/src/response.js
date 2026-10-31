"use strict";

function responseFor(path) {
  switch (path) {
    case "/health": return { code: 200, body: { status: "ok" } };
    case "/": return { code: 200, body: { message: "Hello from Ludion", encoding: "日本語" } };
    default: return { code: 404, body: { error: "not_found" } };
  }
}

module.exports = { responseFor };
