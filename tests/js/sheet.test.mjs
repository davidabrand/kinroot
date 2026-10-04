// The phone bottom sheet: where a drag settles.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.window ||= { matchMedia: () => ({ matches: false, addEventListener() {} }) };
const { snapState } = await import("../../static/js/tree/sheet.js");
const offsets = { full: 0, half: 300, peek: 560 };

test("a slow release settles at the nearest height", () => {
  assert.equal(snapState(offsets, 40, 0), "full");
  assert.equal(snapState(offsets, 280, 0.1), "half");
  assert.equal(snapState(offsets, 520, -0.1), "peek");
});

test("a flick goes one height further in its direction", () => {
  assert.equal(snapState(offsets, 520, -1.2), "half");     // flick up from near the bottom
  assert.equal(snapState(offsets, 290, -1.2), "full");
  assert.equal(snapState(offsets, 320, 1.4), "peek");      // flick down past half
  assert.equal(snapState(offsets, 10, 1.4), "half");
  assert.equal(snapState(offsets, 0, -2), "full");         // already at the top
});
