// The 3D tree: trunk, branches, brass medallions with portraits, leaves,
// golden-hour light, camera moves, highlighting and the time-lapse.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { addLandscape, addSky, applySky, DustMotes, glowTexture, refreshEnvironment, SKY, srgb } from "./sky.js";
import { skyState } from "./skytime.js";
import { TRUNK_HEIGHT } from "./layout.js";
import { computeWood, growSchedule, GROW_YEARS } from "./wood.js";
import { lifespan } from "./util.js";

// Wreath leaves: muted bronze for the living, warm gold in remembrance of those who have passed.
const GREENS = ["#6f5a3a", "#8e7349", "#7a6440", "#9a7f52", "#5f4d33"];
const GOLDS = ["#d2b77d", "#e7cb8e", "#be9b5e", "#f3ddaa", "#c9a86a"];
const REDUCED_MOTION = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
// Preview another time of day by adding ?hour=5.5 (half past five in the morning) to the address.
const PREVIEW_HOUR = (() => {
  const h = parseFloat(new URLSearchParams(location.search).get("hour"));
  return h >= 0 && h < 24 ? h : null;
})();
const TUBE_SEGMENTS = 36;
const TUBE_SIDES = 8;

// Thin a tube gradually from r0 at its start to r1 at its end, so branches taper like real wood.
// (A tube is a ring of vertices at each step along its curve; each ring is shrunk toward its centre.)
function taper(geo, curve, r0, r1) {
  const pos = geo.attributes.position, ring = TUBE_SIDES + 1, c = new THREE.Vector3();
  for (let i = 0; i <= TUBE_SEGMENTS; i++) {
    curve.getPointAt(i / TUBE_SEGMENTS, c);
    const k = (r0 + (r1 - r0) * (i / TUBE_SEGMENTS)) / r0;
    for (let j = 0; j < ring; j++) {
      const n = i * ring + j;
      pos.setXYZ(n, c.x + (pos.getX(n) - c.x) * k, c.y + (pos.getY(n) - c.y) * k, c.z + (pos.getZ(n) - c.z) * k);
    }
  }
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
}

// The portrait disc from Blender can arrive facing backwards (so it's hidden and the brass back
// shows instead), and glTF counts texture rows from the top while our pictures count from the
// bottom. Turn it to face the viewer and flip the rows, so photos and initials sit the right way up.
function faceForward(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  let facing = 0;
  for (let i = 0; i < nor.count; i++) facing += nor.getZ(i);
  if (facing < 0) {
    for (let i = 0; i + 2 < pos.count; i += 3) {          // swap two corners of every triangle
      for (const attr of [pos, nor, uv]) {
        const n = attr.itemSize, a = attr.array;
        for (let k = 0; k < n; k++) [a[(i + 1) * n + k], a[(i + 2) * n + k]] = [a[(i + 2) * n + k], a[(i + 1) * n + k]];
      }
    }
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
  }
  pos.needsUpdate = nor.needsUpdate = uv.needsUpdate = true;
  return geo;
}

const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Small deterministic random numbers, so each person's leaves stay the same between visits.
function seeded(seed) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

export class TreeScene {
  constructor(container, { onPick } = {}) {
    this.container = container;
    this.onPick = onPick || (() => {});
    this.nodes = new Map();
    this.edges = [];
    this.knots = [];
    this.pathMeshes = [];
    this.textures = new Map();
    this.animations = [];
    this.flat = false;
    this.bounds = new THREE.Box3(new THREE.Vector3(-4, 0, -2), new THREE.Vector3(4, 8, 2));
    this._v = new THREE.Vector3();
    this._initRenderer();
    this._initScene();
    this._initInput();
  }

  // ------------------------------------------------------------ setup
  _initRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.5 : 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(r.domElement);
    this.renderer = r;

    this.labels = new CSS2DRenderer();
    Object.assign(this.labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    this.labels.domElement.className = "labels-layer";
    this.container.appendChild(this.labels.domElement);
  }

  _initScene() {
    const scene = (this.scene = new THREE.Scene());
    this.sky = addSky(scene, this.renderer);
    this.fog = scene.fog;
    this.landscape = addLandscape(scene);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1500);
    this.camera.position.set(0, 10, 30);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -500, 1500);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.08, minDistance: 3, maxDistance: 260,
      maxPolarAngle: Math.PI * 0.495, screenSpacePanning: true, autoRotateSpeed: 0.35,
    });
    this.orthoControls = new OrbitControls(this.ortho, this.renderer.domElement);
    Object.assign(this.orthoControls, { enableRotate: false, enableDamping: true, dampingFactor: 0.1, screenSpacePanning: true, minZoom: 0.15, maxZoom: 10 });
    this.orthoControls.enabled = false;
    const stop = () => { this.userMoved = true; this.controls.autoRotate = false; this.animations = this.animations.filter((a) => !a.camera); };
    this.controls.addEventListener("start", stop);
    this.orthoControls.addEventListener("start", stop);

    this.hemi = new THREE.HemisphereLight(0xffe2b8, 0x3b3a22, 0.7);
    scene.add(this.hemi);
    this.lightDir = SKY.sunDir.clone();     // where the main light comes from: the sun, or the moon at night
    const sun = new THREE.DirectionalLight(0xffc27a, 2.8);
    sun.position.copy(this.lightDir).multiplyScalar(80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.sunLight = sun;
    const fill = new THREE.DirectionalLight(0xfff0dc, 0.6);
    fill.position.set(12, 18, 40);
    scene.add(fill);
    this.fillLight = fill;

    this.treeGroup = new THREE.Group();
    scene.add(this.treeGroup);
    this.motes = REDUCED_MOTION ? null : new DustMotes(scene);
    this._applyTime();
    setInterval(() => this._applyTime(), 60_000);

    const dim = (m) => Object.assign(m.clone(), { transparent: true, opacity: 0.14, depthWrite: false });
    const bark = new THREE.MeshStandardMaterial({ color: 0x4f3e2a, roughness: 0.72, metalness: 0.25, envMapIntensity: 0.7 });
    const vine = new THREE.MeshStandardMaterial({ color: 0xbe9b5e, metalness: 0.75, roughness: 0.35, emissive: 0x1e160a });
    const brass = new THREE.MeshStandardMaterial({ color: 0xbe9b5e, metalness: 0.85, roughness: 0.3 });
    const leaf = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide, envMapIntensity: 0.6 });
    this.mats = {
      bark, barkDim: dim(bark), vine, vineDim: dim(vine), brass, brassDim: dim(brass), leaf, leafDim: dim(leaf),
      path: new THREE.MeshStandardMaterial({ color: 0xf3ddaa, emissive: 0xd2b77d, emissiveIntensity: 1.6, roughness: 0.4 }),
      hit: new THREE.MeshBasicMaterial({ visible: false }),
    };
    this.glowTex = glowTexture();
    this.hitGeo = new THREE.SphereGeometry(0.9, 12, 8);
    this.knotGeo = new THREE.SphereGeometry(1, 20, 14);      // scaled to size for every joint in the wood

    new ResizeObserver(() => this.resize()).observe(this.container);
    this.resize();
    this.renderer.setAnimationLoop((t) => this._frame(t));
  }

  _initInput() {
    const dom = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = null;
    dom.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
    dom.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      const rect = dom.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, this.activeCamera());
      const targets = [...this.nodes.values()].filter((n) => n.group.visible).map((n) => n.hit);
      const hit = ray.intersectObjects(targets, false)[0];
      this.onPick(hit ? hit.object.userData.personId : null);
    });
  }

  activeCamera() {
    return this.flat ? this.ortho : this.camera;
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._fitOrtho();
    // Until someone moves the camera themselves, keep the whole tree framed as the window settles.
    if (!this.userMoved && this.nodes?.size) {
      clearTimeout(this._reframe);
      this._reframe = setTimeout(() => this.frameBox(this._lastBox || this.bounds, false), 120);
    }
  }

  // ------------------------------------------------------------ models from Blender (with built-in fallbacks)
  async loadModels(base) {
    const loader = new GLTFLoader();
    const load = (file) => loader.loadAsync(base + file).then((g) => g.scene).catch(() => null);
    const [person, trunk, leaves] = await Promise.all([load("person_node.glb"), load("trunk.glb"), load("leaves.glb")]);
    this.usingBlenderModels = { person: !!person, trunk: !!trunk, leaves: !!leaves };
    this._prepareMedallion(person);
    this._prepareWreaths(leaves);
    this._prepareTrunk(trunk);
  }

  _bake(root, test) {
    // Collect meshes (with their positions baked in) into plain geometries.
    root.updateMatrixWorld(true);
    const out = [];
    root.traverse((o) => {
      if (!o.isMesh || !test(o)) return;
      let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      if (g.index) g = g.toNonIndexed();
      for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      out.push({ geo: g, color: o.material?.color?.clone?.() || new THREE.Color(0x6a9a4c) });
    });
    return out;
  }

  _merge(list) {
    if (!list.length) return null;
    const hasUv = list.every((x) => x.geo.attributes.uv);
    if (!hasUv) list.forEach((x) => x.geo.attributes.uv && x.geo.deleteAttribute("uv"));
    try { return mergeGeometries(list.map((x) => x.geo), false); } catch { return null; }
  }

  _prepareMedallion(glb) {
    let frame = null, portrait = null;
    if (glb) {
      const isPortrait = (o) => o.name === "Portrait" || o.parent?.name === "Portrait";
      frame = this._merge(this._bake(glb, (o) => !isPortrait(o)));
      const p = this._bake(glb, isPortrait)[0];
      portrait = p && p.geo.attributes.uv ? faceForward(p.geo) : null;
    }
    if (!frame || !portrait) {
      const ring = new THREE.TorusGeometry(0.62, 0.085, 12, 48);
      const back = new THREE.CylinderGeometry(0.6, 0.6, 0.04, 48);
      back.rotateX(Math.PI / 2);
      back.translate(0, 0, -0.035);
      const hook = new THREE.TorusGeometry(0.1, 0.026, 8, 20);
      hook.rotateY(Math.PI / 2);
      hook.translate(0, 0.77, 0);
      frame = mergeGeometries([ring, back, hook], false);
      portrait = new THREE.CircleGeometry(0.56, 48);
      portrait.translate(0, 0, 0.012);
    }
    this.frameGeo = frame;
    this.portraitGeo = portrait;
  }

  _prepareWreaths(glb) {
    const green = [], gold = [];
    const pushLeaf = (geo, i, rand) => {
      for (const [list, palette] of [[green, GREENS], [gold, GOLDS]]) {
        const g = geo.clone();
        const c = new THREE.Color(palette[Math.floor(rand() * palette.length) % palette.length]);
        const colors = new Float32Array(g.attributes.position.count * 3);
        for (let k = 0; k < g.attributes.position.count; k++) colors.set([c.r, c.g, c.b], k * 3);
        g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        list.push(g);
      }
    };
    const rand = seeded(7);
    let fromBlender = false;
    if (glb) {
      const leaves = this._bake(glb, () => true);
      if (leaves.length) {
        leaves.forEach((l, i) => { if (!l.geo.attributes.uv) l.geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(l.geo.attributes.position.count * 2), 2)); pushLeaf(l.geo, i, rand); });
        fromBlender = true;
      }
    }
    if (!fromBlender) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.quadraticCurveTo(0.21, 0.3, 0, 0.74);
      shape.quadraticCurveTo(-0.21, 0.3, 0, 0);
      let base = new THREE.ShapeGeometry(shape, 6).toNonIndexed();
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      let i = 0;
      for (const [count, radius, size, depth] of [[10, 0.6, 1.05, -0.12], [12, 0.5, 0.78, -0.07]]) {
        for (let k = 0; k < count; k++) {
          const a = (k / count) * Math.PI * 2 + (depth > -0.1 ? 0.26 : 0) + (rand() - 0.5) * 0.2;
          e.set((rand() - 0.5) * 0.7, (rand() - 0.5) * 0.7, a - Math.PI / 2 + (rand() - 0.5) * 0.35);
          q.setFromEuler(e);
          const s = size * (0.85 + rand() * 0.3);
          m.compose(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, depth), q, new THREE.Vector3(s, s, s));
          pushLeaf(base.clone().applyMatrix4(m), i++, rand);
        }
      }
    }
    this.wreathGreen = mergeGeometries(green, false);
    this.wreathGold = mergeGeometries(gold, false);
  }

  _prepareTrunk(glb) {
    if (glb) {
      const box = new THREE.Box3().setFromObject(glb);
      const height = box.max.y - box.min.y;
      if (height > 0.01) {
        const s = TRUNK_HEIGHT / height;
        glb.scale.setScalar(s);
        glb.position.set(0, -box.min.y * s, 0);
        glb.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.trunkObject = glb;
        return;
      }
    }
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      pts.push(new THREE.Vector2(0.95 - 0.58 * t + 0.5 * Math.pow(1 - t, 6), t * TRUNK_HEIGHT));
    }
    const parts = [new THREE.LatheGeometry(pts, 28)];
    const rand = seeded(3);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + (rand() - 0.5) * 0.5;
      const length = 1.8 + rand() * 0.9;
      const root = new THREE.ConeGeometry(0.3, length, 10);
      const dir = new THREE.Vector3(Math.cos(a), -0.16, Math.sin(a)).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      root.applyQuaternion(q);
      root.translate(dir.x * length * 0.5, 0.22 + dir.y * length * 0.5, dir.z * length * 0.5);
      parts.push(root);
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false), this.mats.bark);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.trunkObject = mesh;
  }

  // ------------------------------------------------------------ building the tree
  build({ people, layout, meId }) {
    this.clearPath();
    for (const node of this.nodes.values()) { node.el.remove(); node.portrait.material.dispose(); node.glow.material.dispose(); }
    for (const e of this.edges) e.mesh.geometry.dispose();
    this.treeGroup.clear();
    this.nodes.clear();
    this.edges = [];
    this.knots = [];
    this.layout = layout;
    this.wood = null;
    if (!people.length) return;

    // How every branch joins up is worked out in wood.js; here it just becomes wood and gold.
    const wood = (this.wood = computeWood(layout));
    this.trunkObject.position.x = wood.trunk.x;            // the trunk stands under the oldest family
    this.trunkObject.position.z = wood.trunk.z;
    this.treeGroup.add(this.trunkObject);
    for (const e of wood.edges) {
      const mesh = this._branch(e.points, e.r0, e.r1, e.kind === "vine" ? this.mats.vine : this.mats.bark);
      this.treeGroup.add(mesh);
      this.edges.push({ ...e, mesh, progress: 1 });
    }
    for (const k of wood.knots) {
      const mesh = new THREE.Mesh(this.knotGeo, this.mats.bark);
      mesh.position.set(k.at.x, k.at.y, k.at.z);
      mesh.scale.setScalar(k.r);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.treeGroup.add(mesh);
      this.knots.push({ ...k, mesh });
    }
    for (const p of people) {
      const node = this._makeNode(p, meId);
      const at = layout.pos.get(p.id);
      node.group.position.set(at.x, at.y, at.z);
      this.treeGroup.add(node.group);
      this.nodes.set(p.id, node);
    }

    this.bounds = new THREE.Box3();
    for (const node of this.nodes.values()) this.bounds.expandByPoint(node.group.position);
    this.bounds.expandByPoint(new THREE.Vector3(wood.trunk.x, 0, wood.trunk.z));
    this.bounds.expandByScalar(1.4);
    this._fitShadows();
    this.motes?.resize(this.bounds);
    this._fitOrtho();
  }

  // A tapering tube along a Bézier curve given as plain {x, y, z} control points.
  _branch(points, r0, r1, mat) {
    const [a, b, c, d] = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const curve = d ? new THREE.CubicBezierCurve3(a, b, c, d) : new THREE.QuadraticBezierCurve3(a, b, c);
    const geo = new THREE.TubeGeometry(curve, TUBE_SEGMENTS, r0, TUBE_SIDES, false);
    if (Math.abs(r1 - r0) > 1e-4) taper(geo, curve, r0, r1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  _makeNode(p, meId) {
    const group = new THREE.Group();
    const rand = seeded(p.id);
    const departed = !!p.deceased;
    const wreath = new THREE.Mesh(departed ? this.wreathGold : this.wreathGreen, this.mats.leaf);
    wreath.rotation.z = rand() * Math.PI * 2;
    wreath.castShadow = true;
    const frame = new THREE.Mesh(this.frameGeo, this.mats.brass);
    frame.castShadow = true;
    const face = this._initialsTexture(p);
    const portraitMat = new THREE.MeshStandardMaterial({
      roughness: 0.78, envMapIntensity: 0.35, map: face, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: 0.38,
    });
    const portrait = new THREE.Mesh(this.portraitGeo, portraitMat);
    if (p.photo_url) this._photoTexture(p.photo_url, (tex) => {
      portraitMat.map = tex;
      portraitMat.emissiveMap = tex;
      portraitMat.needsUpdate = true;
    });

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex, color: 0xffc861, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95,
    }));
    glow.scale.setScalar(3.6);
    glow.position.z = -0.3;
    glow.visible = false;

    const hit = new THREE.Mesh(this.hitGeo, this.mats.hit);
    hit.userData.personId = p.id;

    const el = document.createElement("div");
    el.className = "label3d";
    const name = document.createElement("span");
    name.className = "nm";
    name.textContent = p.first_name;
    if (p.last_name) {
      const last = document.createElement("span");
      last.className = "last";          // hidden when zoomed out or on a phone, so labels don't collide
      last.textContent = " " + p.last_name;
      name.appendChild(last);
    }
    el.appendChild(name);
    if (p.account?.is_me) {
      const you = document.createElement("span");
      you.className = "you";
      you.textContent = "YOU";
      el.appendChild(you);
    }
    const span = lifespan(p);
    if (span) {
      const small = document.createElement("small");
      small.textContent = span;
      el.appendChild(small);
    }
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    el.addEventListener("click", () => this.onPick(p.id));
    const label = new CSS2DObject(el);
    label.position.set(0, -1.3, 0);

    group.add(glow, wreath, frame, portrait, hit, label);
    return { id: p.id, group, wreath, frame, portrait, glow, hit, label, el, departed, shownDeparted: departed, appearAt: null, baseScale: 1 };
  }

  _initialsTexture(p) {
    const initials = ((p.first_name || "?")[0] + (p.last_name ? p.last_name[0] : "")).toUpperCase();
    const key = `initials:${initials}`;
    if (this.textures.has(key)) return this.textures.get(key);
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(110, 96, 10, 128, 128, 150);
    grad.addColorStop(0, "#fffaec");
    grad.addColorStop(1, "#ead9b3");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#1b3326";
    g.font = `800 ${initials.length > 1 ? 104 : 124}px Alegreya, "Iowan Old Style", Georgia, serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(initials, 128, 138);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.textures.set(key, tex);
    return tex;
  }

  _photoTexture(url, done) {
    if (this.textures.has(url)) return done(this.textures.get(url));
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const { width: w, height: h } = tex.image;
      // Crop to a centred square, like a portrait in a locket.
      if (w > h) { tex.repeat.set(h / w, 1); tex.offset.set((1 - h / w) / 2, 0); }
      else if (h > w) { tex.repeat.set(1, w / h); tex.offset.set(0, (1 - w / h) / 2); }
      this.textures.set(url, tex);
      done(tex);
    });
  }

  _fitShadows() {
    const center = this.bounds.getCenter(new THREE.Vector3());
    const size = this.bounds.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) * 0.8 + 8;
    this.sunLight.target.position.copy(center);
    this.sunLight.position.copy(center).addScaledVector(this.lightDir, 120);
    Object.assign(this.sunLight.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 260 });
    this.sunLight.shadow.camera.updateProjectionMatrix();
  }

  // Match the sky and the light to the visitor's clock: stars and moonlight at night,
  // a rosy dawn, golden hour, brighter midday. Runs on load and once a minute.
  _applyTime() {
    const state = skyState(new Date(), PREVIEW_HOUR);
    applySky(this.scene, state);
    this.fog.color.copy(SKY.horizon);            // kept in sync even while the flat view switches fog off
    this.sunLight.color.copy(srgb(state.light));
    this.sunLight.intensity = state.lightI;
    this.lightDir.set(...state.lightDir);
    this.hemi.color.copy(srgb(state.hemiSky));
    this.hemi.groundColor.copy(srgb(state.hemiGround));
    this.hemi.intensity = state.hemiI;
    this.fillLight.intensity = state.fillI;
    this.motes?.points.material.color.copy(srgb(state.motes));   // dust in the sun, fireflies after dark
    this._fitShadows();
    refreshEnvironment(this.scene, this.renderer);
  }

  _fitOrtho() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const size = this.bounds.getSize(new THREE.Vector3());
    const aspect = w / h;
    const halfH = Math.max(size.y / 2, size.x / 2 / aspect) * 1.12;
    Object.assign(this.ortho, { left: -halfH * aspect, right: halfH * aspect, top: halfH, bottom: -halfH });
    this.ortho.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ camera
  frameAll(animate = true) {
    this.frameBox(this.bounds, animate);
  }

  // Frame just some people (for example everyone on a relationship path).
  frameIds(ids, animate = true) {
    const box = new THREE.Box3();
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (node) box.expandByPoint(node.group.position);
    }
    if (box.isEmpty()) return;
    box.expandByScalar(2.2);
    this.frameBox(box, animate);
  }

  frameBox(box, animate = true) {
    this._lastBox = box === this.bounds ? null : box.clone();
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    if (this.flat) {
      this._fitOrtho();
      const full = this.bounds.getSize(new THREE.Vector3());
      const zoom = Math.min(full.x / Math.max(size.x, 1), full.y / Math.max(size.y, 1));
      this.ortho.position.set(center.x, center.y, center.z + 300);
      this.ortho.zoom = box === this.bounds ? 1 : Math.min(Math.max(zoom, 1), 6);
      this.ortho.updateProjectionMatrix();
      this.orthoControls.target.copy(center);
      this.orthoControls.update();
      return;
    }
    const fov = (this.camera.fov * Math.PI) / 180;
    const fitH = size.y / 2 / Math.tan(fov / 2);
    const fitW = size.x / 2 / Math.tan(fov / 2) / this.camera.aspect;
    const dist = Math.max(fitH, fitW, 6) * 1.08 + size.z / 2;
    const target = center.clone();
    const pos = center.clone().add(new THREE.Vector3(dist * 0.18, size.y * 0.06 + 1, dist));
    this.moveCamera(pos, target, animate ? 1100 : 0);
  }

  flyTo(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    const target = node.group.position.clone();
    if (this.flat) {
      this.animations.push(this._tween(this.orthoControls.target.clone(), target, 700, (v) => {
        this.orthoControls.target.copy(v);
        this.ortho.position.set(v.x, v.y, v.z + 300);
      }, true));
      return;
    }
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    dir.y = Math.max(dir.y, 0.05);
    dir.normalize();
    this.moveCamera(target.clone().addScaledVector(dir, 10), target, 900);
  }

  moveCamera(pos, target, ms = 900) {
    if (!ms || REDUCED_MOTION) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    const fromPos = this.camera.position.clone(), fromTarget = this.controls.target.clone();
    this.animations = this.animations.filter((a) => !a.camera);
    this.animations.push({
      camera: true, start: performance.now(), ms,
      step: (k) => {
        this.camera.position.lerpVectors(fromPos, pos, k);
        this.controls.target.lerpVectors(fromTarget, target, k);
      },
    });
  }

  _tween(from, to, ms, apply, camera = false) {
    const v = new THREE.Vector3();
    return { camera, start: performance.now(), ms, step: (k) => apply(v.lerpVectors(from, to, k)) };
  }

  setFlat(on) {
    this.flat = on;
    this.scene.fog = on ? null : this.fog;   // a flat, far-away camera would otherwise sit deep in the haze
    this.landscape?.children.forEach((c) => { if (c.userData.hill) c.visible = !on; });   // hills look odd without perspective
    this.controls.enabled = !on;
    this.orthoControls.enabled = on;
    this.controls.autoRotate = false;
    this.frameAll(false);
  }

  setAutoRotate(on) {
    if (!this.flat && !REDUCED_MOTION) this.controls.autoRotate = on;
  }

  // ------------------------------------------------------------ highlighting
  emphasize({ keep = null, selected = null, path = null } = {}) {
    const onPath = path ? new Set(path) : null;
    for (const node of this.nodes.values()) {
      const dim = !!keep && !keep.has(node.id);
      node.wreath.material = dim ? this.mats.leafDim : this.mats.leaf;
      node.frame.material = dim ? this.mats.brassDim : this.mats.brass;
      if (node.portrait.material.transparent !== dim) {
        node.portrait.material.transparent = dim;
        node.portrait.material.needsUpdate = true;   // three.js compiles "opaque" into the shader
      }
      node.portrait.material.opacity = dim ? 0.2 : 1;
      node.glow.visible = node.id === selected || !!onPath?.has(node.id);
      node.baseScale = node.id === selected ? 1.15 : 1;
      if (node.appearAt == null && node.group.visible) node.group.scale.setScalar(node.baseScale);
      node.el.classList.toggle("dimmed", dim);
      node.el.classList.toggle("selected", node.id === selected);
      node.el.classList.toggle("on-path", !!onPath?.has(node.id));
    }
    // A piece of wood stays lit when every group it joins has someone who's being shown.
    const lit = (groups) => !keep || groups.every((g) => g.some((id) => keep.has(id)));
    for (const e of this.edges) {
      const on = lit(e.groups);
      e.mesh.material = e.kind === "vine" ? (on ? this.mats.vine : this.mats.vineDim) : (on ? this.mats.bark : this.mats.barkDim);
    }
    for (const k of this.knots) k.mesh.material = lit(k.groups) ? this.mats.bark : this.mats.barkDim;
  }

  showPath(path, fam) {
    this.clearPath();
    if (!path || path.length < 2 || !this.wood) return;
    // Light up the actual wood between each pair of relatives: their vine, or the run of branches
    // from a parent's medallion down to their fork, up the stem and out along the child's branch.
    const lit = new Set();
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      if (fam.spouses.get(a)?.includes(b)) {
        const vine = this.wood.vines.get(a < b ? `${a}|${b}` : `${b}|${a}`);
        if (vine != null) lit.add(vine);
      }
      for (const e of this.wood.links.get(`${a}>${b}`) || this.wood.links.get(`${b}>${a}`) || []) lit.add(e);
    }
    const ends = [];
    for (const i of lit) {
      const e = this.edges[i];
      this._addGlow(this._branch(e.points, e.r0 + 0.05, e.r1 + 0.05, this.mats.path));
      if (e.kind !== "vine") ends.push(e.points[0], e.points[e.points.length - 1]);
    }
    // ...and the knots where those branches meet, so the glow runs unbroken.
    for (const k of this.knots) {
      if (!ends.some((p) => Math.hypot(p.x - k.at.x, p.y - k.at.y, p.z - k.at.z) < 1e-6)) continue;
      const glow = new THREE.Mesh(this.knotGeo, this.mats.path);
      glow.position.copy(k.mesh.position);
      glow.scale.setScalar(k.r + 0.05);
      this._addGlow(glow, false);
    }
  }

  _addGlow(mesh, own = true) {
    mesh.castShadow = false;
    mesh.userData.ownGeometry = own;
    this.treeGroup.add(mesh);
    this.pathMeshes.push(mesh);
  }

  clearPath() {
    for (const m of this.pathMeshes) { this.treeGroup.remove(m); if (m.userData.ownGeometry) m.geometry.dispose(); }
    this.pathMeshes = [];
    this._lastBox = null;
  }

  // ------------------------------------------------------------ time-lapse
  setYear(year, { born, died }, animate = true) {
    const now = performance.now();
    // Worked out once per time-lapse: wood grows first, and each medallion appears on the end of its branch.
    if (this._schedFor !== born || this._schedWood !== this.wood) {
      this._sched = this.wood ? growSchedule(this.wood, born) : { start: [], appear: new Map() };
      this._schedFor = born;
      this._schedWood = this.wood;
    }
    const { start, appear } = this._sched;
    for (const node of this.nodes.values()) {
      const visible = year >= (appear.get(node.id) ?? born.get(node.id));
      if (visible && !node.group.visible) {
        node.group.visible = true;
        if (animate && !REDUCED_MOTION) { node.appearAt = now; node.group.scale.setScalar(0.001); }
        else node.group.scale.setScalar(node.baseScale);
      } else if (!visible && node.group.visible) {
        node.group.visible = false;
        node.appearAt = null;
      }
      node.label.visible = visible;
      node.el.classList.toggle("hidden-by-time", !visible);
      const d = died.get(node.id);
      const departed = d != null && year >= d;
      if (departed !== node.shownDeparted) {
        node.wreath.geometry = departed ? this.wreathGold : this.wreathGreen;
        node.shownDeparted = departed;
      }
    }
    const perSegment = TUBE_SIDES * 6;
    for (const [i, e] of this.edges.entries()) {
      e.progress = Math.min(1, Math.max(0, (year - start[i]) / GROW_YEARS));
      e.mesh.visible = e.progress > 0;
      e.mesh.geometry.setDrawRange(0, Math.round(e.progress * TUBE_SEGMENTS) * perSegment);
    }
    // A knot appears once the branch that brings the wood to it has fully grown.
    for (const k of this.knots) k.mesh.visible = k.carrier == null || this.edges[k.carrier].progress >= 0.98;
    // The past looks like an old photograph and warms into full colour as it nears today.
    const age = Math.max(0, Math.min(1, (new Date().getFullYear() - year) / 110));
    this.renderer.domElement.style.filter = age > 0.02 ? `sepia(${(age * 0.6).toFixed(2)}) saturate(${(1 - age * 0.2).toFixed(2)})` : "";
  }

  endTimeline() {
    for (const node of this.nodes.values()) {
      node.group.visible = true;
      node.label.visible = true;
      node.appearAt = null;
      node.group.scale.setScalar(node.baseScale);
      node.el.classList.remove("hidden-by-time");
      if (node.shownDeparted !== node.departed) {
        node.wreath.geometry = node.departed ? this.wreathGold : this.wreathGreen;
        node.shownDeparted = node.departed;
      }
    }
    for (const e of this.edges) {
      e.progress = 1;
      e.mesh.visible = true;
      e.mesh.geometry.setDrawRange(0, Infinity);
    }
    for (const k of this.knots) k.mesh.visible = true;
    this.renderer.domElement.style.filter = "";
  }

  // ------------------------------------------------------------ pictures and Blender export
  snapshot(title) {
    const cam = this.activeCamera();
    this.renderer.render(this.scene, cam);
    const src = this.renderer.domElement;
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    const g = out.getContext("2d");
    g.drawImage(src, 0, 0);
    const scale = src.width / (this.container.clientWidth || 1);
    g.textAlign = "center";
    for (const node of this.nodes.values()) {
      if (!node.group.visible) continue;
      const v = node.group.position.clone().add(new THREE.Vector3(0, -1.3, 0)).project(cam);
      if (v.z > 1) continue;
      const x = (v.x * 0.5 + 0.5) * out.width, y = (-v.y * 0.5 + 0.5) * out.height;
      const text = node.el.querySelector("span")?.textContent || "";
      g.font = `700 ${Math.round(13 * scale)}px "Alegreya Sans", "Segoe UI", sans-serif`;
      const w = g.measureText(text).width + 16 * scale, h = 22 * scale;
      g.fillStyle = "rgba(24,32,22,0.72)";
      roundRect(g, x - w / 2, y - h / 2, w, h, 8 * scale);
      g.fillStyle = "#fffaf0";
      g.fillText(text, x, y + 4.5 * scale);
    }
    g.font = `800 ${Math.round(30 * scale)}px Alegreya, Georgia, serif`;
    g.textAlign = "left";
    g.fillStyle = "#fff9ea";
    g.shadowColor = "rgba(60,30,0,0.55)";
    g.shadowBlur = 12 * scale;
    g.fillText(title, 24 * scale, 48 * scale);
    g.font = `700 ${Math.round(14 * scale)}px "Alegreya Sans", sans-serif`;
    g.fillText("made with kinroot", 24 * scale, out.height - 20 * scale);
    return new Promise((resolve) => out.toBlob(resolve, "image/png"));
  }

  exportForBlender(people, treeName) {
    const round = (n) => Math.round(n * 1000) / 1000;
    const pt = (v) => [round(v.x), round(v.y), round(v.z)];
    return {
      kinroot: 1, tree: treeName, exported: new Date().toISOString(), trunk_height: TRUNK_HEIGHT,
      people: people.filter((p) => this.nodes.has(p.id)).map((p) => ({
        id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(" "), lifespan: lifespan(p),
        initials: ((p.first_name || "?")[0] + (p.last_name ? p.last_name[0] : "")).toUpperCase(),
        position: pt(this.nodes.get(p.id).group.position), departed: !!p.deceased,
        photo: p.photo_url ? p.photo_url.split("/").pop() : null,
      })),
      trunk_position: pt(new THREE.Vector3(this.trunkObject.position.x, 0, this.trunkObject.position.z)),
      branches: this.edges.map((e) => ({
        kind: e.kind, radius: round(e.r0), radius_end: round(e.r1),
        points: e.mesh.geometry.parameters.path.getPoints(24).map(pt),
      })),
      knots: this.knots.map((k) => ({ position: pt(k.mesh.position), radius: round(k.r) })),
    };
  }

  // ------------------------------------------------------------ render loop
  _frame(t) {
    this.animations = this.animations.filter((a) => {
      const k = Math.min(1, (t - a.start) / a.ms);
      a.step(easeInOut(k));
      return k < 1;
    });
    const cam = this.activeCamera();
    (this.flat ? this.orthoControls : this.controls).update();
    this.sky.position.copy(cam.position);
    for (const node of this.nodes.values()) {
      const g = node.group;
      if (!g.visible) continue;
      this._v.set(cam.position.x, g.position.y, cam.position.z);
      if (this.flat) this._v.set(g.position.x, g.position.y, g.position.z + 10);
      g.lookAt(this._v);
      if (node.appearAt != null) {
        const k = Math.min(1, (t - node.appearAt) / 650);
        g.scale.setScalar(Math.max(0.001, node.baseScale * easeOutBack(k)));
        if (k >= 1) node.appearAt = null;
      }
    }
    this.motes?.update(t);
    const far = this.flat ? this.ortho.zoom < 0.8 : cam.position.distanceTo(this.controls.target) > 40;
    if (far !== this._far) { this._far = far; this.container.classList.toggle("far", far); }
    this.renderer.render(this.scene, cam);
    this.labels.render(this.scene, cam);
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fill();
}
