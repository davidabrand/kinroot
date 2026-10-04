// The sky follows the visitor's own clock: night with stars and the moon, a rosy
// blue hour before sunrise, golden light at dawn and dusk, brighter by midday.
// Pure maths (no Three.js), so it can be tested in Node.
//
// We never ask for the visitor's location. The sun's height is worked out for a
// mid-northern latitude from the local time and date (with daylight saving taken
// into account), which is close enough to get "very early sunrise" right.

const LATITUDE = 40;
const RAD = Math.PI / 180;
const SYNODIC_MONTH = 29.530588853;                       // days from new moon to new moon
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);      // a new moon to count from

// Sky looks keyed by the sun's height in degrees. Colours blend between neighbours.
// The 8° row is Kinroot's signature golden hour; the others are tuned around it.
export const KEYFRAMES = [
  { alt: -18, top: "#070d1c", mid: "#111a33", horizon: "#232c48", ground: "#11160f", sun: "#000000",
    glow: 0, stars: 1, light: "#9fb4e0", lightI: 0.55, hemiSky: "#5d6f9a", hemiGround: "#141a14", hemiI: 0.45, fillI: 0.3, motes: "#d6f08c" },
  { alt: -9, top: "#18214a", mid: "#4b4778", horizon: "#b87063", ground: "#2e2a22", sun: "#ff7a4a",
    glow: 0.35, stars: 0.35, light: "#c9a3c0", lightI: 0.8, hemiSky: "#8f86b3", hemiGround: "#2a2620", hemiI: 0.55, fillI: 0.35, motes: "#ffd29a" },
  { alt: -1, top: "#4d5e8e", mid: "#c08480", horizon: "#f79a55", ground: "#7d5f3e", sun: "#ff8c42",
    glow: 0.75, stars: 0, light: "#ff9d5c", lightI: 1.9, hemiSky: "#ffc59a", hemiGround: "#3b3022", hemiI: 0.6, fillI: 0.45, motes: "#ffd9a0" },
  { alt: 8, top: "#8fa8b6", mid: "#e6c39a", horizon: "#f6c98a", ground: "#b99461", sun: "#ffb257",
    glow: 0.55, stars: 0, light: "#ffc27a", lightI: 2.8, hemiSky: "#ffe2b8", hemiGround: "#3b3a22", hemiI: 0.7, fillI: 0.6, motes: "#ffe2a0" },
  { alt: 30, top: "#5f93c2", mid: "#a6c7dc", horizon: "#f1e0bd", ground: "#b99461", sun: "#fff1d0",
    glow: 0.25, stars: 0, light: "#fff1dc", lightI: 3.0, hemiSky: "#e8f0f4", hemiGround: "#3b3a22", hemiI: 0.8, fillI: 0.6, motes: "#fff1c8" },
];

const COLOR_KEYS = ["top", "mid", "horizon", "ground", "sun", "light", "hemiSky", "hemiGround", "motes"];
const NUMBER_KEYS = ["glow", "stars", "lightI", "hemiI", "fillI"];

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Is daylight saving in effect on this date, wherever the visitor is?
function dstHours(when) {
  const y = when.getFullYear();
  const standard = Math.max(new Date(y, 0, 1).getTimezoneOffset(), new Date(y, 6, 1).getTimezoneOffset());
  return (standard - when.getTimezoneOffset()) / 60;
}

function dayOfYear(when) {
  return Math.floor((Date.UTC(when.getFullYear(), when.getMonth(), when.getDate()) - Date.UTC(when.getFullYear(), 0, 0)) / 864e5);
}

// Height above the horizon (degrees) for a body at this hour angle and declination.
function altitude(hourAngle, declination) {
  const s = Math.sin(LATITUDE * RAD) * Math.sin(declination * RAD)
    + Math.cos(LATITUDE * RAD) * Math.cos(declination * RAD) * Math.cos(hourAngle * RAD);
  return Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
}

const wrap180 = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;

// Where the sun is: altitude (degrees) and hour angle (degrees; negative = morning).
// `hour` (0–24, local) can override the clock, e.g. from ?hour=5.5 in the address bar.
export function sunPosition(when = new Date(), hour = null) {
  const h = hour ?? when.getHours() + when.getMinutes() / 60 + when.getSeconds() / 3600;
  const declination = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear(when) + 10));
  const hourAngle = wrap180((h - 12 - dstHours(when)) * 15);
  return { altitude: altitude(hourAngle, declination), hourAngle, declination };
}

// The moon's phase (0 = new, 0.5 = full) and, roughly, where it is in the sky.
export function moonPosition(when = new Date(), sun = sunPosition(when)) {
  const phase = ((((when.getTime() - KNOWN_NEW_MOON) / 864e5) % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH / SYNODIC_MONTH;
  // The moon trails the sun by its phase: a full moon rises as the sun sets.
  const hourAngle = wrap180(sun.hourAngle - phase * 360);
  const declination = sun.declination * Math.cos(phase * 2 * Math.PI);
  return { phase, hourAngle, altitude: altitude(hourAngle, declination) };
}

// A direction in the 3D scene. Bodies travel across the sky *behind* the tree
// (rising on the right, setting on the left, where the golden-hour sun has always
// been) and their height is squeezed so dawn and dusk sit low in view.
export function sceneDirection(hourAngle, alt) {
  // A narrow arc (±40°), so the sun and moon stay in view behind the tree.
  const across = Math.max(-1, Math.min(1, hourAngle / 110)) * 40 * RAD;
  const lift = (alt > 0 ? alt * 0.5 : alt * 0.8) * RAD;
  const x = -Math.sin(across) * Math.cos(lift), y = Math.sin(lift), z = -Math.cos(across) * Math.cos(lift);
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

// Blend the keyframes for a given sun height.
export function palette(sunAlt) {
  let a = KEYFRAMES[0], b = KEYFRAMES[0], k = 0;
  if (sunAlt >= KEYFRAMES[KEYFRAMES.length - 1].alt) {
    a = b = KEYFRAMES[KEYFRAMES.length - 1];
  } else if (sunAlt > KEYFRAMES[0].alt) {
    const i = KEYFRAMES.findIndex((f) => f.alt > sunAlt);
    a = KEYFRAMES[i - 1];
    b = KEYFRAMES[i];
    k = (sunAlt - a.alt) / (b.alt - a.alt);
    k = k * k * (3 - 2 * k);                              // ease, so the bands don't look stepped
  }
  const out = {};
  for (const key of COLOR_KEYS) {
    const ca = hexToRgb(a[key]), cb = hexToRgb(b[key]);
    out[key] = ca.map((v, j) => v + (cb[j] - v) * k);
  }
  for (const key of NUMBER_KEYS) out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
}

// Everything the scene needs for this moment.
export function skyState(when = new Date(), hour = null) {
  const sun = sunPosition(when, hour);
  const moon = moonPosition(when, sun);
  const night = sun.altitude < -4;
  const moonUp = moon.altitude > 2 && moon.phase > 0.03 && moon.phase < 0.97;
  const sunDir = sceneDirection(sun.hourAngle, sun.altitude);
  const moonDir = sceneDirection(moon.hourAngle, Math.max(moon.altitude, 6));
  return {
    ...palette(sun.altitude),
    sunAltitude: sun.altitude,
    sunDir, moonDir,
    moonPhase: moon.phase,
    moonVisible: moonUp && sun.altitude < 6 ? 1 : 0,
    sunVisible: sun.altitude > -3 ? 1 : 0,
    // After dark the shadow-casting light comes from the moon (or a high glow if it's down).
    // Kept a little above the horizon, so nothing is ever lit from under the ground.
    lightDir: night ? (moonUp ? moonDir : [0.3, 0.8, -0.5]) : sceneDirection(sun.hourAngle, Math.max(sun.altitude, 3)),
  };
}
