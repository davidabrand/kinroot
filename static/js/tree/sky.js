// The sky dome: a layered gradient that follows the time of day (see skytime.js),
// with a sun glow along the horizon, a moon with its real phase, and stars at night.
// The same sky is used as the environment map, so brass medallions reflect its light.
import * as THREE from "three";

const srgb = (rgb) => new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);

// Live values, updated in place by applySky() so every material using them follows along.
// They start at Kinroot's signature golden hour.
export const SKY = {
  top: new THREE.Color("#8fa8b6"),      // dusty evening blue overhead
  mid: new THREE.Color("#e6c39a"),
  horizon: new THREE.Color("#f6c98a"),  // honey haze at the horizon
  ground: new THREE.Color("#b99461"),
  sun: new THREE.Color("#ffb257"),
  // Low in the sky, behind the tree and to the left, so branches get a warm rim light.
  sunDir: new THREE.Vector3(-0.5, 0.2, -0.84).normalize(),
  moonDir: new THREE.Vector3(0.5, 0.4, -0.77).normalize(),
};

const uniforms = {
  topColor: { value: SKY.top }, midColor: { value: SKY.mid }, horizonColor: { value: SKY.horizon },
  groundColor: { value: SKY.ground }, sunColor: { value: SKY.sun }, sunDir: { value: SKY.sunDir },
  moonDir: { value: SKY.moonDir }, glow: { value: 0.55 }, stars: { value: 0 },
  moonPhase: { value: 0.5 }, moonVisible: { value: 0 }, sunVisible: { value: 1 },
};

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 midColor;
  uniform vec3 horizonColor;
  uniform vec3 groundColor;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  uniform vec3 moonDir;
  uniform float glow;
  uniform float stars;
  uniform float moonPhase;
  uniform float moonVisible;
  uniform float sunVisible;
  varying vec3 vDir;

  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;

    // Three bands: horizon haze -> mid sky -> overhead.
    vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.22, h));
    col = mix(col, topColor, smoothstep(0.12, 0.75, h));

    // Warm light pooling along the horizon on the sun's side of the sky.
    vec2 flatDir = dir.xz / max(length(dir.xz), 1e-4);
    vec2 sunFlat = sunDir.xz / max(length(sunDir.xz), 1e-4);
    float side = max(dot(flatDir, sunFlat), 0.0);
    col += sunColor * glow * pow(side, 3.0) * (1.0 - smoothstep(-0.02, 0.35, h)) * 0.6;

    // Stars, fading in as it gets dark (round points, not square cells).
    if (stars > 0.0 && h > 0.0) {
      vec3 cell = floor(dir * 260.0);
      float r = hash(cell);
      float d = length(fract(dir * 260.0) - 0.5);
      col += vec3(0.9, 0.93, 1.0) * stars * step(0.9965, r) * (1.0 - smoothstep(0.12, 0.3, d))
           * smoothstep(0.02, 0.2, h) * (0.5 + 0.5 * hash(cell + 7.0));
    }

    col = mix(col, groundColor, clamp(-h * 5.0, 0.0, 1.0));

    // The sun: a soft halo and a bright disc.
    float s = max(dot(dir, normalize(sunDir)), 0.0);
    col += sunColor * sunVisible * (pow(s, 5.0) * 0.28 + pow(s, 48.0) * 0.55);
    col = mix(col, vec3(1.0, 0.96, 0.84), sunVisible * smoothstep(0.9990, 0.9995, s) * step(0.0, h));

    // The moon, lit on the side that matches tonight's phase.
    if (moonVisible > 0.0) {
      vec3 md = normalize(moonDir);
      float m = dot(dir, md);
      col += vec3(0.75, 0.8, 0.95) * pow(max(m, 0.0), 300.0) * 0.25 * moonVisible;
      float radius = 0.026;
      vec3 right = normalize(cross(md, vec3(0.0, 1.0, 0.0)));
      vec3 up = cross(right, md);
      vec2 q = vec2(dot(dir, right), dot(dir, up)) / radius;
      float edge = 1.0 - smoothstep(0.92, 1.0, length(q));
      if (m > 0.0 && edge > 0.0) {
        float halfWidth = sqrt(max(1.0 - q.y * q.y, 0.0));
        float term = cos(moonPhase * 6.28318) * halfWidth;
        float lit = moonPhase < 0.5 ? smoothstep(term - 0.06, term + 0.06, q.x)
                                    : 1.0 - smoothstep(-term - 0.06, -term + 0.06, q.x);
        vec3 face = mix(col + vec3(0.04, 0.05, 0.08), vec3(0.96, 0.95, 0.88), lit);
        col = mix(col, face, edge * moonVisible);
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

function skyMaterial() {
  // Both domes share one uniforms object, so updating it changes both.
  return new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false, fog: false,
  });
}

let envScene = null;

// Re-bake the reflections from the current sky (cheap: a tiny sphere).
export function refreshEnvironment(scene, renderer) {
  try {
    if (!envScene) {
      envScene = new THREE.Scene();
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), skyMaterial()));
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    const old = scene.environment;
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    pmrem.dispose();
    old?.dispose();
  } catch (err) {
    console.warn("Kinroot: no environment lighting", err);
  }
}

export function addSky(scene, renderer) {
  // Fallback colour in case the shader can't compile on some old graphics chip.
  scene.background = SKY.horizon.clone();
  scene.fog = new THREE.Fog(SKY.horizon.clone(), 60, 320);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 48, 24), skyMaterial());
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);
  refreshEnvironment(scene, renderer);
  return sky;
}

// Point the sky at a moment in time: `state` comes from skyState() in skytime.js.
export function applySky(scene, state) {
  for (const key of ["top", "mid", "horizon", "ground", "sun"]) SKY[key].copy(srgb(state[key]));
  SKY.sunDir.set(...state.sunDir);
  SKY.moonDir.set(...state.moonDir);
  uniforms.glow.value = state.glow;
  uniforms.stars.value = state.stars;
  uniforms.moonPhase.value = state.moonPhase;
  uniforms.moonVisible.value = state.moonVisible;
  uniforms.sunVisible.value = state.sunVisible;
  scene.background?.copy?.(SKY.horizon);
  scene.fog?.color.copy(SKY.horizon);
}

export { srgb };

export function addLandscape(scene) {
  const group = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 64),
    new THREE.MeshStandardMaterial({ color: 0x5c7440, roughness: 1, envMapIntensity: 0.5 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Soft rolling hills fading into the haze.
  const hillMat = [0x7d8a4a, 0x93935a, 0x6f8043].map((c) =>
    new THREE.MeshStandardMaterial({ color: c, roughness: 1, envMapIntensity: 0.4 }));
  const hills = [
    [-120, -170, 90, 22, 60, 0], [40, -210, 120, 30, 70, 1], [170, -160, 80, 18, 55, 2],
    [-230, -60, 70, 16, 70, 1], [240, -40, 80, 20, 70, 0],
  ];
  for (const [x, z, sx, sy, sz, m] of hills) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), hillMat[m]);
    hill.scale.set(sx, sy, sz);
    hill.position.set(x, -sy * 0.35, z);
    hill.userData.hill = true;
    group.add(hill);
  }
  scene.add(group);
  return group;
}

// A soft round sprite used for dust motes and glows.
export function glowTexture(inner = "rgba(255,244,214,1)", outer = "rgba(255,200,110,0)") {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, "rgba(255,221,150,0.55)");
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class DustMotes {
  constructor(scene, count = 320) {
    this.count = count;
    this.geo = new THREE.BufferGeometry();
    this.base = new Float32Array(count * 3);
    this.pos = new Float32Array(count * 3);
    this.phase = new Float32Array(count);
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({
      size: 0.16, map: glowTexture(), color: 0xffe2a0, transparent: true, opacity: 0.8,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.resize(new THREE.Box3(new THREE.Vector3(-10, 0, -6), new THREE.Vector3(10, 14, 6)));
  }

  resize(box) {
    const size = box.getSize(new THREE.Vector3());
    for (let i = 0; i < this.count; i++) {
      this.base[i * 3] = box.min.x - 4 + Math.random() * (size.x + 8);
      this.base[i * 3 + 1] = 0.5 + Math.random() * (size.y + box.min.y + 4);
      this.base[i * 3 + 2] = box.min.z - 4 + Math.random() * (size.z + 8);
      this.phase[i] = Math.random() * Math.PI * 2;
    }
    this.update(0);
  }

  update(t) {
    for (let i = 0; i < this.count; i++) {
      const p = this.phase[i];
      this.pos[i * 3] = this.base[i * 3] + Math.sin(t * 0.00011 + p) * 0.9;
      this.pos[i * 3 + 1] = this.base[i * 3 + 1] + Math.sin(t * 0.00023 + p * 1.7) * 0.5;
      this.pos[i * 3 + 2] = this.base[i * 3 + 2] + Math.cos(t * 0.00009 + p) * 0.7;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
