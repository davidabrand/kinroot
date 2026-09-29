// Golden-hour sky: a gradient dome with a low sun, warm haze, and floating dust.
// The same sky is used as the environment map, so brass medallions reflect sunset light.
import * as THREE from "three";

export const SKY = {
  top: new THREE.Color("#8fa8b6"),      // dusty evening blue overhead
  horizon: new THREE.Color("#f6c98a"),  // honey haze at the horizon
  ground: new THREE.Color("#b99461"),
  sun: new THREE.Color("#ffb257"),
  // Low in the sky, behind the tree and to the left, so branches get a warm rim light.
  sunDir: new THREE.Vector3(-0.5, 0.2, -0.84).normalize(),
};

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 groundColor;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    vec3 col = mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.6));
    col = mix(col, groundColor, clamp(-h * 5.0, 0.0, 1.0));
    float s = max(dot(dir, normalize(sunDir)), 0.0);
    col += sunColor * (pow(s, 5.0) * 0.28 + pow(s, 48.0) * 0.55);
    col = mix(col, vec3(1.0, 0.96, 0.84), smoothstep(0.9990, 0.9995, s));
    gl_FragColor = vec4(col, 1.0);
  }`;

function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: SKY.top }, horizonColor: { value: SKY.horizon }, groundColor: { value: SKY.ground },
      sunColor: { value: SKY.sun }, sunDir: { value: SKY.sunDir },
    },
    vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false, fog: false,
  });
}

export function addSky(scene, renderer) {
  // Fallback colour in case the shader can't compile on some old graphics chip.
  scene.background = SKY.horizon.clone();
  scene.fog = new THREE.Fog(SKY.horizon.clone(), 60, 320);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 48, 24), skyMaterial());
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  // Reflections and soft light from the same sky.
  try {
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), skyMaterial()));
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    pmrem.dispose();
  } catch (err) {
    console.warn("Kinroot: no environment lighting", err);
  }
  return sky;
}

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
