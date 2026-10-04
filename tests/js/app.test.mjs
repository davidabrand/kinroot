// app.js runs on every page; an exception at the top level silently disables everything
// after it (the double-submit guard, the delete-tree guard). Run it against a minimal fake
// page, with and without an invite anchor, and make sure it finishes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../static/js/app.js", import.meta.url), "utf8");

function runApp(hash) {
  const page = {
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
  };
  const context = {
    document: page,
    location: { hash },
    window: { addEventListener() {} },
    navigator: {},
    setTimeout: () => 0,
  };
  vm.runInNewContext(source, context);
}

test("app.js runs to the end on an ordinary page", () => {
  assert.doesNotThrow(() => runApp(""));
  assert.doesNotThrow(() => runApp("#features"));
});

test("app.js runs to the end on the page for a just-made invite link", () => {
  assert.doesNotThrow(() => runApp("#invite-row-7"));
});
