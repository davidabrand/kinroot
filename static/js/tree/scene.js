// The 3D tree: a family suspended in warm dark space.
//
// People are ivory portrait medallions (HTML, so photos, type and keyboard focus are crisp and
// accessible); relationships are thin bronze lines drawn in WebGL. layout.js decides where everyone
// sits and links.js how the lines run; this file only draws them, moves the camera, and animates.
// Nothing is drawn while nothing changes.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { R } from "./layout.js";
import { buildLinks, routePoints } from "./links.js";
import { fullName, lifespan } from "./util.js";

const REDUCED_MOTION = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const BRONZE = [0.745, 0.608, 0.369];       // #BE9B5E
const GOLD = [0.906, 0.765, 0.502];         // #E7C380, warm gold
const INK = [0.067, 0.071, 0.055];          // the stage behind the lines (#11120E)
const CAP_GAP = 10;                         // px between a caption and the line arriving under it
const MOVE_MS = 850;                        // a layout change settling
const GROW_MS = 700;                        // a new line extending to someone just added
const LOD = [[46, "full"], [32, "name"], [18, "bare"], [0, "dot"]];   // medallion size (px) → what shows

// cubic-bezier(.2, .7, .2, 1): quick to start, long gentle settle, no bounce.
function bezier(x1, y1, x2, y2) {
  const f = (a, b, t) => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
  return (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const dx = f(x1, x2, t) - x;
      const d = 3 * x1 * (1 - t) * (1 - t) + 6 * (x2 - x1) * (1 - t) * t + 3 * (1 - x2) * t * t;
      if (Math.abs(dx) < 1e-5 || !d) break;
      t = Math.min(1, Math.max(0, t - dx / d));
    }
    return f(y1, y2, t);
  };
}
const settle = bezier(0.2, 0.7, 0.2, 1);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function initials(p) {
  return ((p.first_name || "?")[0] + (p.last_name ? p.last_name[0] : "")).toUpperCase();
}

function generationName(diff) {
  if (diff === 0) return "You";
  const n = Math.abs(diff), down = diff < 0;
  const base = down ? ["Parents", "Grandparents", "Great-grandparents"] : ["Children", "Grandchildren", "Great-grandchildren"];
  return n <= 3 ? base[n - 1] : `${n - 2}× great-${down ? "grandparents" : "grandchildren"}`;
}

export class TreeScene {
  constructor(container, { onPick, onHover, onUnknown } = {}) {
    this.container = container;
    this.onPick = onPick || (() => {});
    this.onHover = onHover || (() => {});
    this.onUnknown = onUnknown || (() => {});
    this.nodes = new Map();
    this.genLabels = [];
    this.layout = null;
    this.links = { curves: [], junctions: [] };
    this.state = { keep: null, selected: null, path: null, hover: null };
    this.timeline = null;
    this.flat = false;
    this.animations = [];
    this.bounds = new THREE.Box3(new THREE.Vector3(-4, -2, -2), new THREE.Vector3(4, 6, 2));
    this._dirty = 3;
    this._linesDirty = true;
    this._initRenderer();
    this._initCamera();
    this._initInput();
    for (const c of [this.controls, this.orthoControls]) c.addEventListener("change", () => { this._clampPan(); this.invalidate(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.invalidate(); });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop((t) => this._frame(t));
  }

  // Ask for the next few frames to be drawn.
  invalidate(frames = 3) { this._dirty = Math.max(this._dirty, frames); }

  // ------------------------------------------------------------ setup
  _initRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setClearColor(0x000000, 0);
    this.container.appendChild(r.domElement);
    this.renderer = r;
    this.scene = new THREE.Scene();

    this.labels = new CSS2DRenderer();
    Object.assign(this.labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    this.labels.domElement.className = "labels-layer";
    this.container.appendChild(this.labels.domElement);

    // Lines: one batch for everything, one for the lit family of whoever is selected,
    // and the relationship route (a soft band under a bright core). Solid lines whose colour is
    // the bronze already blended into the dark, so joints and crossings never double up into beads.
    const mat = (width) => new LineMaterial({ linewidth: width, vertexColors: true, depthTest: false, depthWrite: false, worldUnits: false });
    this.mats = { base: mat(1.4), accent: mat(1.9), routeGlow: mat(5), route: mat(2.1) };
    this.layers = {};
    for (const [name, order] of [["base", 1], ["accent", 2], ["routeGlow", 3], ["route", 4]]) {
      const line = new LineSegments2(new LineSegmentsGeometry(), this.mats[name]);
      line.renderOrder = order;
      line.frustumCulled = false;
      line.visible = false;
      this.scene.add(line);
      this.layers[name] = line;
    }
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 2000);
    this.camera.position.set(0, 6, 40);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -500, 2000);
    const el = this.container;
    // Drag moves around the family; right-drag (or two fingers) tilts, within gentle limits;
    // the wheel zooms toward the pointer. Nobody ends up upside down or lost in empty space.
    this.controls = new OrbitControls(this.camera, el);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.09, screenSpacePanning: true, zoomToCursor: true,
      minDistance: 3.5, maxDistance: 200, minPolarAngle: Math.PI * 0.36, maxPolarAngle: Math.PI * 0.58,
      minAzimuthAngle: -0.6, maxAzimuthAngle: 0.6, rotateSpeed: 0.55, zoomSpeed: 0.9,
    });
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.orthoControls = new OrbitControls(this.ortho, el);
    Object.assign(this.orthoControls, { enableRotate: false, enableDamping: true, dampingFactor: 0.1, screenSpacePanning: true,
      zoomToCursor: true, minZoom: 0.12, maxZoom: 8 });
    this.orthoControls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.orthoControls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    this.orthoControls.enabled = false;
    const stop = () => {
      this.userMoved = true;
      this.animations = this.animations.filter((a) => !a.camera);
      this.container.classList.add("touched");
    };
    this.controls.addEventListener("start", stop);
    this.orthoControls.addEventListener("start", stop);
  }

  // Clicks are worked out by hand: the camera controls capture the pointer, so the browser's own
  // click would land on the stage rather than the portrait. A press that barely moves is a click;
  // two on the same person in quick succession are a double-click (focus on them).
  _initInput() {
    const el = this.container;
    let down = null, last = null;
    const idOf = (target) => {
      const btn = target?.closest?.(".kn");
      return btn ? Number(btn.dataset.id) : null;
    };
    el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, id: idOf(e.target) }; });
    el.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
      const id = down.id;
      down = null;
      const now = performance.now();
      if (id != null && last && last.id === id && now - last.t < 380) { last = null; this._activate(id, true); return; }
      last = { id, t: now };
      this._activate(id, false);
    });
    // Keyboard: Enter or Space on a focused portrait (a real button) selects it.
    el.addEventListener("click", (e) => { if (e.detail === 0) { const id = idOf(e.target); if (id != null) this._activate(id, false); } });
    el.addEventListener("pointerover", (e) => {
      if (e.pointerType !== "mouse") return;
      const id = idOf(e.target);
      if (id != null && id > 0 && id !== this._hoverId) { this._hoverId = id; this.onHover(id); }
    });
    el.addEventListener("pointerout", (e) => {
      if (e.pointerType !== "mouse" || this._hoverId == null) return;
      if (idOf(e.relatedTarget) === this._hoverId) return;
      this._hoverId = null;
      this.onHover(null);
    });
  }

  _activate(id, double) {
    if (id != null && id < 0) {
      const ph = this.layout?.placeholders.find((p) => p.id === id);
      if (ph) this.onUnknown(ph.childId);
      return;
    }
    this.onPick(id);
    if (double && id != null) this.focusOn(id);
  }

  activeCamera() { return this.flat ? this.ortho : this.camera; }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    for (const m of Object.values(this.mats)) m.resolution.set(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._fitOrtho();
    if (!this.userMoved && this.nodes.size) {
      clearTimeout(this._reframe);
      this._reframe = setTimeout(() => this.frameBox(this._lastBox || this.bounds, false), 120);
    }
    this.invalidate();
  }

  // ------------------------------------------------------------ building the tree
  build({ people, layout, meId = null, canEdit = false }) {
    const first = !this.layout;
    const now = performance.now();
    const oldKeys = new Set(this.links.curves.map((c) => c.key));
    this.layout = layout;
    this.canEdit = canEdit;
    const wanted = new Map(people.map((p) => [p.id, p]));
    for (const ph of layout.placeholders) wanted.set(ph.id, { id: ph.id, placeholder: true, first_name: "Unknown", childId: ph.childId });
    // Gone: removed from the tree.
    for (const [id, node] of this.nodes) {
      if (wanted.has(id)) continue;
      node.obj.removeFromParent();
      node.anchor.remove();
      this.nodes.delete(id);
    }
    const from = new Map();
    for (const [id, p] of wanted) {
      const at = layout.pos.get(id);
      if (!at) continue;
      let node = this.nodes.get(id);
      if (!node) {
        node = this._makeNode(id);
        node.cur = { ...at };
        if (!first) node.btn.classList.add("kn-enter");   // someone new: fades and settles into place
      } else {
        from.set(id, { ...node.cur });
      }
      node.target = { ...at };
      this._fillNode(node, p);
      node.obj.position.set(node.cur.x, node.cur.y, node.cur.z);
    }
    if (from.size && !REDUCED_MOTION && [...from].some(([id, f]) => {
      const t = this.nodes.get(id).target;
      return Math.abs(t.x - f.x) + Math.abs(t.y - f.y) + Math.abs(t.z - f.z) > 1e-3;
    })) {
      this._move = { start: now, from };
    } else {
      for (const node of this.nodes.values()) {
        node.cur = { ...node.target };
        node.obj.position.set(node.cur.x, node.cur.y, node.cur.z);
      }
      this._move = null;
    }
    this._buildGenLabels(people, meId);
    this._rebuildLines();
    // Lines that didn't exist before (to someone just added) extend gently into place.
    if (!first && !REDUCED_MOTION) for (const c of this.links.curves) if (!oldKeys.has(c.key)) this._grow.set(c.key, now);
    this._computeBounds();
    this._fitOrtho();
    this.controls.maxDistance = Math.max(40, this._fitDistance(this.bounds) * 2.4);
    this.invalidate();
  }

  _makeNode(id) {
    const anchor = document.createElement("div");
    anchor.className = "kn-anchor";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "kn";
    btn.dataset.id = id;
    anchor.appendChild(btn);
    const obj = new CSS2DObject(anchor);
    this.scene.add(obj);
    const node = { id, anchor, btn, obj, cur: null, target: null, sig: "", lod: "", d: 0, capPx: 0, ppu: 1 };
    this.nodes.set(id, node);
    return node;
  }

  // The medallion and its caption. Rebuilt only when something shown has changed.
  _fillNode(node, p) {
    const me = !!p.account?.is_me;
    const span = p.placeholder ? "" : lifespan(p);
    const sig = JSON.stringify([p.first_name, p.last_name, span, p.photo_url, me, p.deceased, p.placeholder, this.canEdit]);
    if (sig === node.sig) return;
    node.sig = sig;
    const btn = node.btn;
    btn.replaceChildren();
    btn.classList.toggle("kn-me", me);
    btn.classList.toggle("kn-unknown", !!p.placeholder);
    btn.classList.toggle("kn-departed", !!p.deceased);
    node.departed = !!p.deceased;
    const disc = document.createElement("span");
    disc.className = "kn-disc";
    if (p.placeholder) {
      // An unknown parent: an empty dashed ring.
    } else if (p.photo_url) {
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.draggable = false;
      img.src = p.photo_url;
      disc.appendChild(img);
      node.img = img;
    } else {
      const ini = document.createElement("span");
      ini.className = "kn-ini";
      ini.textContent = initials(p);
      disc.appendChild(ini);
      node.img = null;
    }
    const cap = document.createElement("span");
    cap.className = "kn-cap";
    const name = document.createElement("span");
    name.className = "kn-name";
    if (p.placeholder) {
      name.textContent = "Unknown";
    } else {
      name.append(p.first_name || "");
      if (p.last_name) {
        const last = document.createElement("span");
        last.className = "kn-last";
        last.textContent = " " + p.last_name;
        name.appendChild(last);
      }
    }
    cap.appendChild(name);
    if (span || p.placeholder) {
      const dates = document.createElement("span");
      dates.className = "kn-dates";
      dates.textContent = p.placeholder ? (this.canEdit ? "Add a parent" : "") : span.replace(/^born /, "") + (/^born /.test(span) ? " —" : "");
      cap.appendChild(dates);
    }
    if (me) {
      const you = document.createElement("span");
      you.className = "kn-you";
      you.textContent = "You";
      cap.appendChild(you);
    }
    btn.append(disc, cap);
    node.cap = cap;
    node.name = p.placeholder ? "Unknown parent" : fullName(p);
    node.span = span;
    btn.setAttribute("aria-label", p.placeholder
      ? (this.canEdit ? "Unknown parent. Add a parent here" : "Unknown parent")
      : [fullName(p), span, me ? "you" : ""].filter(Boolean).join(", "));
    if (p.placeholder && !this.canEdit) btn.tabIndex = -1;
    node.lod = "";                  // re-measure the caption on the next frame
  }

  // Quiet labels at the side of each band: Parents, Grandparents… (only when you're on the tree).
  _buildGenLabels(people, meId) {
    for (const g of this.genLabels) { g.obj.removeFromParent(); g.el.remove(); }
    this.genLabels = [];
    const me = people.find((p) => p.account?.is_me);
    if (!me || !this.layout.gen.has(me.id)) return;
    const meRow = this.layout.gen.get(me.id);
    this.layout.rows.forEach((row, g) => {
      const ids = row.filter((id) => this.nodes.has(id));
      if (!ids.length) return;
      const left = ids.reduce((a, b) => (this.layout.pos.get(a).x < this.layout.pos.get(b).x ? a : b));
      const at = this.layout.pos.get(left);
      const el = document.createElement("div");
      el.className = "kn-gen";
      const text = document.createElement("span");           // right-aligned against the band's first portrait
      text.textContent = generationName(g - meRow);
      el.appendChild(text);
      const obj = new CSS2DObject(el);
      obj.position.set(at.x - R - 0.7, at.y, at.z);
      this.scene.add(obj);
      this.genLabels.push({ el, obj });
    });
  }

  _computeBounds() {
    const box = new THREE.Box3();
    for (const node of this.nodes.values()) {
      const t = node.target;
      box.expandByPoint(new THREE.Vector3(t.x - R - 0.5, t.y - R - 1.3, t.z));
      box.expandByPoint(new THREE.Vector3(t.x + R + 0.5, t.y + R + 0.2, t.z));
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-4, -2, -2), new THREE.Vector3(4, 6, 2));
    box.max.y += 1.4;              // breathing room above the youngest band, clear of the toolbar
    this.bounds = box;
  }

  // ------------------------------------------------------------ lines
  _rebuildLines() {
    if (!this.layout) return;
    this._grow ||= new Map();
    const now = performance.now();
    const posOf = (id) => this.nodes.get(id)?.cur || null;
    const dropOf = (id) => {
      const n = this.nodes.get(id);
      return n && n.capPx ? (n.capPx + CAP_GAP) / n.ppu : 0;
    };
    this.links = buildLinks(this.layout, posOf, dropOf);
    const { keep, selected, hover } = this.state;
    const tl = this.timeline;
    const base = { pos: [], col: [] }, accent = { pos: [], col: [] };
    let growing = false;
    const add = (out, pts, rgb, alpha, progress = 1, fade = false) => {
      const n = pts.length - 1;
      const upto = progress * n;
      for (let i = 0; i < n && i < upto; i++) {
        const a = pts[i], b0 = pts[i + 1];
        const k = Math.min(1, upto - i);
        const b = k < 1 ? [a[0] + (b0[0] - a[0]) * k, a[1] + (b0[1] - a[1]) * k, a[2] + (b0[2] - a[2]) * k] : b0;
        const fa = fade ? Math.pow(1 - i / n, 1.5) : 1, fb = fade ? Math.pow(1 - (i + 1) / n, 1.5) : 1;
        out.pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        for (const f of [alpha * fa, alpha * fb]) out.col.push(...mix(rgb, f));
      }
    };
    const mix = (rgb, a) => [INK[0] + (rgb[0] - INK[0]) * a, INK[1] + (rgb[1] - INK[1]) * a, INK[2] + (rgb[2] - INK[2]) * a];
    const shown = (id) => !tl || id < 0 ? !tl : tl.born.get(id) <= tl.year;
    for (const c of this.links.curves) {
      let alpha = c.kind === "partner" ? 0.5 : c.kind === "root" ? 0.3 : 0.42;
      if (c.faint) alpha *= 0.4;
      let progress = 1;
      if (tl) {
        if (c.ids.some((id) => id < 0)) continue;
        if (c.kind === "child") progress = clamp01((tl.year - (tl.born.get(c.child) - 1.4)) / 1.4);
        else if (c.kind === "partner") progress = c.ids.every(shown) ? clamp01(tl.year - Math.max(...c.ids.map((id) => tl.born.get(id))) - 18) : 0;
        if (progress <= 0) continue;
      }
      const grownAt = this._grow.get(c.key);
      if (grownAt != null) {
        const k = clamp01((now - grownAt) / GROW_MS);
        progress = Math.min(progress, settle(k));
        if (k >= 1) this._grow.delete(c.key); else growing = true;
      }
      const touches = (id) => (c.kind === "child" ? c.child === id || c.parents.includes(id) : c.ids.includes(id));
      const lit = !keep || (c.kind === "child" ? keep.has(c.child) && c.parents.some((p) => keep.has(p)) : c.ids.every((id) => keep.has(id)));
      if (!lit) alpha *= 0.16;
      else if (selected != null && c.kind !== "root") {
        if (touches(selected)) { add(accent, c.pts, GOLD, 0.95, progress); continue; }
        alpha *= 0.72;
      }
      if (lit && hover != null && hover !== selected && c.kind !== "root" && touches(hover)) alpha = Math.min(0.9, alpha * 1.8);
      add(base, c.pts, BRONZE, alpha, progress, c.kind === "root");
    }
    // A tiny bead where a couple's children branch off.
    for (const j of this.links.junctions) {
      // In the time-lapse the bead appears with the couple's line, not before it.
      if (tl && (j.ids.some((id) => id < 0 || !shown(id)) || tl.year < Math.max(...j.ids.map((id) => tl.born.get(id))) + 18)) continue;
      const lit = !keep || j.ids.every((id) => keep.has(id));
      const sel = lit && selected != null && j.ids.includes(selected);
      const ring = [];
      for (let k = 0; k <= 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        ring.push([j.at[0] + Math.cos(a) * 0.075, j.at[1] + Math.sin(a) * 0.075, j.at[2]]);
      }
      add(sel ? accent : base, ring, sel ? GOLD : BRONZE, lit ? (sel ? 0.95 : 0.7) : 0.12);
    }
    this._setLayer("base", base);
    this._setLayer("accent", accent);
    this._growing = growing;
    this._linesDirty = false;
  }

  _setLayer(name, { pos, col }) {
    const line = this.layers[name];
    line.geometry.dispose();
    const geo = new LineSegmentsGeometry();
    if (pos.length) { geo.setPositions(pos); geo.setColors(col); }
    line.geometry = geo;
    line.visible = pos.length > 0;
  }

  // ------------------------------------------------------------ camera
  _fitDistance(box) {
    const size = box.getSize(new THREE.Vector3());
    const fov = (this.camera.fov * Math.PI) / 180;
    const fitH = size.y / 2 / Math.tan(fov / 2);
    const fitW = size.x / 2 / Math.tan(fov / 2) / this.camera.aspect;
    return Math.max(fitH, fitW, 7) * 1.12 + size.z / 2;
  }

  _fitOrtho() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const size = this.bounds.getSize(new THREE.Vector3());
    const halfH = Math.max(size.y / 2, size.x / 2 / (w / h), 4) * 1.12;
    Object.assign(this.ortho, { left: -halfH * (w / h), right: halfH * (w / h), top: halfH, bottom: -halfH });
    this.ortho.updateProjectionMatrix();
  }

  // Keep the view over the family: panning stops a little past its edges.
  _clampPan() {
    if (this._clamping) return;
    const c = this.flat ? this.orthoControls : this.controls, cam = this.activeCamera();
    const b = this.bounds.clone().expandByScalar(6);
    const t = c.target, clamped = t.clone().clamp(b.min, b.max);
    if (clamped.distanceToSquared(t) < 1e-8) return;
    this._clamping = true;
    cam.position.add(clamped.clone().sub(t));
    t.copy(clamped);
    this._clamping = false;
  }

  // Frame every person currently shown (or a filtered part of the family).
  frameAll(animate = true, opts = {}) {
    const keep = this.state.keep;
    if (keep && keep.size > 1 && !this.timeline) {
      const box = this._boxOf([...keep]);
      if (box) return this.frameBox(box, animate, opts);
    }
    this.frameBox(this.bounds, animate, opts);
  }

  frameIds(ids, animate = true) {
    const box = this._boxOf(ids);
    if (box) this.frameBox(box, animate);
  }

  _boxOf(ids) {
    const box = new THREE.Box3();
    for (const id of ids) {
      const t = this.nodes.get(id)?.target;
      if (!t) continue;
      box.expandByPoint(new THREE.Vector3(t.x - R - 1, t.y - R - 1.4, t.z));
      box.expandByPoint(new THREE.Vector3(t.x + R + 1, t.y + R + 1.6, t.z));   // room for the toolbar above
    }
    return box.isEmpty() ? null : box;
  }

  // `lift` raises the subject on screen (as a share of its height), e.g. to clear a bar along the bottom.
  frameBox(box, animate = true, { lift = 0 } = {}) {
    this._lastBox = box === this.bounds ? null : box.clone();
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    if (this.flat) {
      this._fitOrtho();
      const full = this.bounds.getSize(new THREE.Vector3());
      const zoom = Math.min(full.x / Math.max(size.x, 1), full.y / Math.max(size.y, 1));
      this.ortho.position.set(center.x, center.y - size.y * lift, 300);
      this.ortho.zoom = box === this.bounds ? 1 / (1 + lift) : Math.min(Math.max(zoom, 1), 6);
      this.ortho.updateProjectionMatrix();
      this.orthoControls.target.set(center.x, center.y - size.y * lift, 0);
      this.orthoControls.update();
      this.invalidate();
      return;
    }
    const dist = this._fitDistance(box) * (1 + lift);
    const target = center.clone();
    target.y -= size.y * lift;
    const dir = new THREE.Vector3(0.1, 0.12, 1).normalize();
    this.moveCamera(target.clone().addScaledVector(dir, dist), target, animate ? 1100 : 0);
  }

  // The distance at which a medallion shows `px` pixels wide.
  _distanceFor(px) {
    const h = this.container.clientHeight || 1;
    return (2 * R * h) / (2 * Math.tan((this.camera.fov * Math.PI) / 360) * px);
  }

  // Selecting someone: recentre on them gently, keeping the current zoom unless they'd be tiny.
  flyTo(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    const t = node.target;
    const target = new THREE.Vector3(t.x, t.y - 0.3, t.z);
    if (this.flat) {
      const from = this.orthoControls.target.clone();
      this._animate(700, (k) => {
        this.orthoControls.target.lerpVectors(from, target, k);
        this.ortho.position.set(this.orthoControls.target.x, this.orthoControls.target.y, 300);
        if (this.ortho.zoom < 1.2) { this.ortho.zoom += (1.2 - this.ortho.zoom) * k * 0.2; this.ortho.updateProjectionMatrix(); }
      }, true);
      return;
    }
    const offset = this.camera.position.clone().sub(this.controls.target);
    const dist = Math.min(offset.length(), this._distanceFor(62));
    this.moveCamera(target.clone().add(offset.setLength(dist)), target, 900);
  }

  // Double-click: come in close.
  focusOn(id) {
    const node = this.nodes.get(id);
    if (!node || this.flat) return this.flyTo(id);
    const t = node.target;
    const target = new THREE.Vector3(t.x, t.y - 0.3, t.z);
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.moveCamera(target.clone().add(offset.setLength(this._distanceFor(104))), target, 900);
  }

  // Face the family straight on again, keeping where you're looking and how close.
  resetView() {
    if (this.flat) return this.frameAll();
    const target = this.controls.target.clone();
    const dist = this.camera.position.distanceTo(target);
    this.moveCamera(target.clone().addScaledVector(new THREE.Vector3(0.1, 0.12, 1).normalize(), dist), target, 800);
  }

  zoomBy(factor) {
    if (this.flat) {
      const from = this.ortho.zoom;
      const to = Math.min(this.orthoControls.maxZoom, Math.max(this.orthoControls.minZoom, from / factor));
      this._animate(350, (k) => { this.ortho.zoom = from + (to - from) * k; this.ortho.updateProjectionMatrix(); }, true);
      return;
    }
    const target = this.controls.target.clone();
    const offset = this.camera.position.clone().sub(target);
    const dist = Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, offset.length() * factor));
    this.moveCamera(target.clone().add(offset.setLength(dist)), target, 450);
  }

  moveCamera(pos, target, ms = 900) {
    if (!ms || REDUCED_MOTION) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.invalidate();
      return;
    }
    const fromPos = this.camera.position.clone(), fromTarget = this.controls.target.clone();
    this._animate(ms, (k) => {
      this.camera.position.lerpVectors(fromPos, pos, k);
      this.controls.target.lerpVectors(fromTarget, target, k);
    }, true);
  }

  _animate(ms, step, camera = false) {
    if (camera) this.animations = this.animations.filter((a) => !a.camera);
    this.animations.push({ camera, start: performance.now(), ms, step });
    this.invalidate();
  }

  setFlat(on) {
    this.flat = on;
    this.controls.enabled = !on;
    this.orthoControls.enabled = on;
    this.container.classList.toggle("is-flat", on);
    this.frameAll(false);
    this.invalidate();
  }

  // The family stays still unless you move it (kept so callers don't need to know).
  setAutoRotate() {}

  // ------------------------------------------------------------ highlighting
  emphasize({ keep = null, selected = null, path = null, hover = null } = {}) {
    this.state = { keep, selected, path, hover };
    const onPath = path ? new Map(path.map((id, i) => [id, i])) : null;
    const step = path ? Math.min(380, 1800 / Math.max(1, path.length - 1)) : 0;
    for (const node of this.nodes.values()) {
      const b = node.btn;
      const shown = !keep || keep.has(node.id) || (node.id < 0 && keep.has(this._childOf(node.id)));
      b.classList.toggle("is-dim", !shown);
      b.classList.toggle("is-selected", node.id === selected);
      b.classList.toggle("is-hover", node.id === hover && hover !== selected);
      const i = onPath?.get(node.id);
      b.classList.toggle("on-path", i != null);
      if (i != null) b.style.setProperty("--path-delay", `${Math.round(i * step)}ms`);
      if (node.id === selected) b.setAttribute("aria-pressed", "true"); else b.removeAttribute("aria-pressed");
    }
    this.container.classList.toggle("has-path", !!path);
    this._linesDirty = true;
    this.invalidate();
  }

  _childOf(placeholderId) {
    return this.layout?.placeholders.find((p) => p.id === placeholderId)?.childId;
  }

  // Relationship mode: a gold line travels the exact route from one person to the other,
  // lighting each relative on the way in turn.
  showPath(path) {
    this.clearPath();
    if (!path || path.length < 2 || !this.layout) return;
    const pts = routePoints(path, this.layout, this.links);
    if (pts.length < 2) return;
    const pos = [];
    for (let i = 0; i < pts.length - 1; i++) pos.push(...pts[i], ...pts[i + 1]);
    const colors = (rgb, a) => pos.map((_, i) => INK[i % 3] + (rgb[i % 3] - INK[i % 3]) * a);
    this._setLayer("route", { pos, col: colors(GOLD, 1) });
    this._setLayer("routeGlow", { pos, col: colors(GOLD, 0.13) });
    const segs = pts.length - 1;
    const ms = REDUCED_MOTION ? 1 : Math.min(2600, Math.max(900, 500 + 380 * (path.length - 1)));
    const set = (k) => {
      const n = Math.max(1, Math.round(segs * k));
      this.layers.route.geometry.instanceCount = n;
      this.layers.routeGlow.geometry.instanceCount = n;
    };
    set(0);
    this._animate(ms, set);
  }

  clearPath() {
    for (const name of ["route", "routeGlow"]) this._setLayer(name, { pos: [], col: [] });
    this._lastBox = null;
    this.invalidate();
  }

  // ------------------------------------------------------------ time-lapse
  setYear(year, { born, died }) {
    this.timeline = { year, born, died };
    for (const node of this.nodes.values()) {
      const visible = node.id > 0 && born.get(node.id) <= year;
      node.btn.classList.toggle("kn-hidden", !visible);
      const d = died.get(node.id);
      node.btn.classList.toggle("kn-departed", d != null && year >= d);
    }
    for (const g of this.genLabels) g.el.classList.add("kn-hidden");
    this._linesDirty = true;
    this.invalidate();
  }

  endTimeline() {
    this.timeline = null;
    for (const node of this.nodes.values()) {
      node.btn.classList.remove("kn-hidden");
      node.btn.classList.toggle("kn-departed", !!node.departed);
    }
    for (const g of this.genLabels) g.el.classList.remove("kn-hidden");
    this._linesDirty = true;
    this.invalidate();
  }

  // ------------------------------------------------------------ pictures and Blender export
  // A picture of the current view: the lines as drawn, with each medallion and name painted on top.
  async snapshot(title) {
    const cam = this.activeCamera();
    this.renderer.render(this.scene, cam);
    const src = this.renderer.domElement;
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    const g = out.getContext("2d");
    const s = src.width / (this.container.clientWidth || 1);
    const bg = g.createRadialGradient(out.width / 2, out.height * 0.52, 0, out.width / 2, out.height * 0.52, Math.max(out.width, out.height) * 0.7);
    bg.addColorStop(0, "#17160f");
    bg.addColorStop(0.55, "#0d0e0b");
    bg.addColorStop(1, "#090a09");
    g.fillStyle = bg;
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(src, 0, 0);
    const v = new THREE.Vector3();
    const list = [...this.nodes.values()].filter((n) => n.id > 0 && !n.btn.classList.contains("kn-hidden"));
    for (const node of list) {
      v.set(node.cur.x, node.cur.y, node.cur.z).project(cam);
      if (v.z > 1) continue;
      const x = (v.x * 0.5 + 0.5) * out.width, y = (-v.y * 0.5 + 0.5) * out.height;
      const r = (Math.min(150, Math.max(8, node.d || 40)) / 2) * s;
      g.save();
      g.globalAlpha = node.btn.classList.contains("is-dim") ? 0.25 : 1;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      const face = g.createRadialGradient(x - r * 0.3, y - r * 0.4, 0, x, y, r);
      face.addColorStop(0, "#fffbf0");
      face.addColorStop(1, "#e6d7b6");
      g.fillStyle = face;
      g.fill();
      if (node.img?.complete && node.img.naturalWidth) {
        g.save();
        g.clip();
        const iw = node.img.naturalWidth, ih = node.img.naturalHeight, k = Math.max((2 * r) / iw, (2 * r) / ih);
        g.drawImage(node.img, x - (iw * k) / 2, y - (ih * k) / 2, iw * k, ih * k);
        g.restore();
      } else if (r > 9 * s) {
        g.fillStyle = "#1a1813";
        g.font = `500 ${Math.round(r * 0.72)}px "Cormorant Garamond", Georgia, serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(node.btn.querySelector(".kn-ini")?.textContent || "", x, y + r * 0.04);
      }
      g.lineWidth = (node.btn.classList.contains("kn-me") || node.btn.classList.contains("is-selected") ? 2 : 1.5) * s;
      g.strokeStyle = node.btn.classList.contains("kn-me") || node.btn.classList.contains("is-selected") ? "#e7cb8e" : "#a98a57";
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
      if (node.lod === "full" || node.lod === "name") {
        g.textAlign = "center";
        g.textBaseline = "top";
        g.shadowColor = "#090a09";
        g.shadowBlur = 6 * s;
        g.fillStyle = "#f1ebdd";
        g.font = `500 ${Math.round(15 * s)}px "Cormorant Garamond", Georgia, serif`;
        g.fillText(node.name, x, y + r + 7 * s);
        if (node.lod === "full" && node.span) {
          g.fillStyle = "rgba(241,235,221,0.6)";
          g.font = `500 ${Math.round(10.5 * s)}px Manrope, "Segoe UI", sans-serif`;
          g.fillText(node.span, x, y + r + 26 * s);
        }
      }
      g.restore();
    }
    g.fillStyle = "#f1ebdd";
    g.font = `500 ${Math.round(30 * s)}px "Cormorant Garamond", Georgia, serif`;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillText(title, 28 * s, 52 * s);
    g.fillStyle = "rgba(210,183,125,0.8)";
    g.font = `600 ${Math.round(11 * s)}px Manrope, "Segoe UI", sans-serif`;
    g.fillText("KINROOT", 28 * s, out.height - 24 * s);
    return new Promise((resolve) => out.toBlob(resolve, "image/png"));
  }

  exportForBlender(people, treeName) {
    const round = (n) => Math.round(n * 1000) / 1000;
    const pt = (p) => [round(p.x), round(p.y), round(p.z)];
    return {
      kinroot: 2, tree: treeName, exported: new Date().toISOString(),
      trunk_height: 0.001, trunk_position: [0, 0, 0],          // the tree has no trunk any more
      people: people.filter((p) => this.nodes.has(p.id)).map((p) => ({
        id: p.id, name: fullName(p), lifespan: lifespan(p), initials: initials(p),
        position: pt(this.nodes.get(p.id).target), departed: !!p.deceased,
        photo: p.photo_url ? p.photo_url.split("/").pop() : null,
      })),
      branches: this.links.curves.filter((c) => c.kind !== "root" && !c.ids.some((id) => id < 0)).map((c) => ({
        kind: c.kind === "partner" ? "vine" : "branch", radius: 0.03, radius_end: 0.03,
        points: c.pts.map((p) => p.map(round)),
      })),
      knots: [],
    };
  }

  // ------------------------------------------------------------ render loop
  _frame(t) {
    const moved = (this.flat ? this.orthoControls : this.controls).update();
    const busy = moved || this._move || this._growing || this.animations.length;
    if (!busy && this._dirty <= 0 && !this._linesDirty) return;   // idle: draw nothing
    if (this._dirty > 0) this._dirty--;
    this.animations = this.animations.filter((a) => {
      const k = Math.min(1, (t - a.start) / a.ms);
      a.step(settle(k));
      return k < 1;
    });
    // A layout change: everyone glides from where they were to where they now belong.
    if (this._move) {
      const k = settle(clamp01((t - this._move.start) / MOVE_MS));
      for (const node of this.nodes.values()) {
        const f = this._move.from.get(node.id);
        if (!f) continue;
        node.cur = { x: f.x + (node.target.x - f.x) * k, y: f.y + (node.target.y - f.y) * k, z: f.z + (node.target.z - f.z) * k };
        node.obj.position.set(node.cur.x, node.cur.y, node.cur.z);
      }
      if (k >= 1) this._move = null;
      this._linesDirty = true;
    }
    if (this._growing) this._linesDirty = true;
    const cam = this.activeCamera();
    cam.updateMatrixWorld();
    this._updateSizes(cam);
    if (this._linesDirty) this._rebuildLines();
    this.renderer.render(this.scene, cam);
    this.labels.render(this.scene, cam);
    // Captions that changed size: measure them now they're on the page, so lines stop just below.
    if (this._measure?.length) {
      for (const node of this._measure) node.capPx = node.cap && node.cap.offsetParent !== null ? node.cap.offsetHeight : 0;
      this._measure = [];
      this._linesDirty = true;
      this.invalidate(1);
    }
    if (this._move || this._growing || this.animations.length) this.invalidate(1);
  }

  // Every medallion is sized for its distance from the camera, and shows more or less detail
  // with it: portraits always, names when there's room, dates when there's plenty.
  _updateSizes(cam) {
    const h = this.container.clientHeight || 1;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360);
    const orthoPpu = (h * this.ortho.zoom) / (this.ortho.top - this.ortho.bottom);
    const changedLod = [];
    let dropChanged = false;
    for (const node of this.nodes.values()) {
      let ppu;
      if (this.flat) ppu = orthoPpu;
      else {
        const depth = (node.cur.x - cam.position.x) * fwd.x + (node.cur.y - cam.position.y) * fwd.y + (node.cur.z - cam.position.z) * fwd.z;
        ppu = depth > 0.1 ? h / (2 * tanHalf * depth) : 1;
      }
      const d = Math.min(150, Math.max(7, 2 * R * ppu));
      if (Math.abs(d - node.d) > 0.4) { node.btn.style.setProperty("--d", `${d.toFixed(1)}px`); node.d = d; }
      const oldDrop = node.capPx ? (node.capPx + CAP_GAP) / node.ppu : 0;
      node.ppu = ppu;
      const lod = LOD.find(([min]) => d >= min)[1];
      if (lod !== node.lod) { node.lod = lod; node.btn.dataset.lod = lod; changedLod.push(node); }
      else if (node.capPx && Math.abs((node.capPx + CAP_GAP) / ppu - oldDrop) > 0.03) dropChanged = true;
    }
    if (changedLod.length) this._measure = [...(this._measure || []), ...changedLod];
    if (dropChanged) this._linesDirty = true;
    const ref = this.flat ? 2 * R * orthoPpu : 2 * R * h / (2 * tanHalf * Math.max(0.1, cam.position.distanceTo(this.controls.target)));
    const zoom = ref >= 40 ? "near" : ref >= 22 ? "mid" : "far";
    if (zoom !== this._zoom) { this._zoom = zoom; this.container.dataset.zoom = zoom; }
  }
}

