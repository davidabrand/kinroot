// Time-of-day sky maths. Run by tests/test_js.py (needs Node 22+), in New York time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KEYFRAMES, hexToRgb, moonPosition, palette, sceneDirection, skyState, sunPosition } from "../../static/js/tree/skytime.js";

const day = (iso) => new Date(iso);          // local (New York) time
const alt = (iso, hour = null) => sunPosition(day(iso), hour).altitude;

test("night, blue hour, sunrise and midday on an October morning", () => {
  assert.ok(alt("2026-10-04T03:00") < -18, "3am is full night");
  const blue = alt("2026-10-04T06:30");
  assert.ok(blue > -12 && blue < -4, `6:30am is the blue hour before sunrise (got ${blue})`);
  const rise = alt("2026-10-04T07:10");
  assert.ok(rise > -3 && rise < 3, `about 7am the sun is on the horizon (got ${rise})`);
  assert.ok(alt("2026-10-04T13:00") > 40, "1pm is high sun");
});

test("daylight saving moves solar noon to 1pm", () => {
  assert.ok(Math.abs(sunPosition(day("2026-01-15T12:00")).hourAngle) < 1);
  assert.ok(Math.abs(sunPosition(day("2026-07-15T13:00")).hourAngle) < 1);
  assert.ok(alt("2026-07-15T13:00") > alt("2026-01-15T12:00") + 30, "summer sun is far higher");
});

test("an ?hour= preview overrides the clock", () => {
  assert.equal(alt("2026-10-04T13:00", 3), alt("2026-10-04T03:00"));
});

test("moon phase matches real new and full moons", () => {
  const eclipse = moonPosition(new Date(Date.UTC(2024, 3, 8, 18, 21))).phase;   // 2024 solar eclipse
  assert.ok(eclipse < 0.02 || eclipse > 0.98, `new moon (got ${eclipse})`);
  const full = moonPosition(new Date(Date.UTC(2024, 3, 23, 23, 49))).phase;
  assert.ok(Math.abs(full - 0.5) < 0.03, `full moon (got ${full})`);
});

test("golden hour keeps Kinroot's signature colours", () => {
  const golden = KEYFRAMES.find((f) => f.alt === 8);
  const p = palette(8);
  for (const key of ["top", "mid", "horizon", "ground", "sun"]) {
    hexToRgb(golden[key]).forEach((v, i) => assert.ok(Math.abs(p[key][i] - v) < 1e-9, key));
  }
  assert.equal(palette(-40).stars, 1);
  assert.equal(palette(70).stars, 0);
});

test("directions: unit length, behind the tree, rising right and setting left", () => {
  const morning = sceneDirection(-80, 5), evening = sceneDirection(80, 5);
  for (const d of [morning, evening]) assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-9);
  assert.ok(morning[0] > 0 && evening[0] < 0);
  assert.ok(morning[2] < 0 && evening[2] < 0);
});

test("every minute of the day gives sane colours and a light above the ground", () => {
  for (let m = 0; m < 24 * 60; m += 15) {
    const s = skyState(day("2026-10-04T00:00"), m / 60);
    assert.ok(s.lightDir[1] > 0, `light from below the ground at ${m / 60}h`);
    for (const key of ["top", "mid", "horizon", "ground", "sun", "light"]) {
      for (const v of s[key]) assert.ok(v >= 0 && v <= 1, `${key} out of range at ${m / 60}h`);
    }
  }
});
