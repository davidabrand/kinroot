// Phones: the details panel becomes a bottom sheet over the tree, like a maps app.
// Three heights: "peek" (just the heading), "half" and "full". Drag the grip, or tap it to step up.
// On a wider screen it's an ordinary side panel and none of this applies.
const PHONE = "(max-width: 860px)";
const ORDER = ["peek", "half", "full"];

// Where a drag should settle: the nearest height, nudged one step by a quick flick. Pure, so it's testable.
export function snapState(offsets, y, velocity) {
  // offsets: { peek, half, full } as distances from the top of the sheet's travel (px); y: where it was let go.
  const states = ORDER.filter((st) => offsets[st] != null);
  const nearest = (list) => list.reduce((a, b) => (Math.abs(offsets[b] - y) < Math.abs(offsets[a] - y) ? b : a));
  if (Math.abs(velocity) > 0.5) {                     // px per ms: a flick goes to the next height that way
    const ahead = states.filter((st) => (velocity < 0 ? offsets[st] < y : offsets[st] > y));
    if (ahead.length) return nearest(ahead);
  }
  return nearest(states);
}

export class Sheet {
  constructor(root, grip, { onChange } = {}) {
    this.root = root;
    this.grip = grip;
    this.panel = root.querySelector(".side-panel");
    this.onChange = onChange || (() => {});
    this.media = window.matchMedia(PHONE);
    this.state = "peek";
    this.media.addEventListener("change", () => this._apply());
    new ResizeObserver(() => this._apply()).observe(root.parentElement);
    grip.addEventListener("click", () => {
      if (this._dragged) return;
      this.set(this.state === "full" ? "peek" : ORDER[ORDER.indexOf(this.state) + 1]);
    });
    this._initDrag();
    this._apply();
  }

  get active() { return this.media.matches; }

  set(state) {
    if (!ORDER.includes(state)) return;
    this.state = state;
    this._apply();
  }

  // Bring the sheet up at least this far (never pulls it down).
  raise(state) {
    if (ORDER.indexOf(state) > ORDER.indexOf(this.state)) this.set(state);
  }

  // How far down the sheet sits for each height, in px from the top of its travel.
  offsets() {
    const h = this.root.offsetHeight;
    const peek = parseFloat(getComputedStyle(this.root).getPropertyValue("--peek")) || 132;
    return { full: 0, half: Math.round(h * 0.48), peek: Math.max(0, h - peek) };
  }

  // How many pixels of the tree the sheet is covering right now. Fully open, the tree is hidden
  // anyway, so the view stays where it was at half (and is right there again when you come back down).
  covered() {
    if (!this.active) return 0;
    const state = this.state === "full" ? "half" : this.state;
    return Math.max(0, this.root.offsetHeight - this.offsets()[state]);
  }

  _apply() {
    this.root.dataset.sheet = this.active ? this.state : "";
    const open = this.state !== "peek";
    this.grip.setAttribute("aria-expanded", String(open));
    this.grip.setAttribute("aria-label", this.state === "full" ? "Lower the details" : "Show more details");
    if (this.state !== "full") this.panel.scrollTop = 0;
    this._fade(this.active ? this.offsets()[this.state] : null);
    this.onChange(this.covered());
  }

  // The tree fades out as the sheet rises past half, so a fully open sheet reads as its own page.
  _fade(y) {
    const layout = this.root.parentElement;
    if (y == null) { layout.style.removeProperty("--tree-show"); return; }
    const o = this.offsets();
    const show = Math.min(1, Math.max(0, y / Math.max(1, o.half)));
    layout.style.setProperty("--tree-show", show.toFixed(3));
  }

  // One drag, from the grip (mouse or finger) or from a swipe on the sheet's content.
  _begin(clientY) {
    const y0 = this.offsets()[this.state];
    this._drag = { y: clientY, y0, last: clientY, lastT: performance.now(), v: 0 };
    this._dragged = false;
    this.root.classList.add("dragging");
    this.root.parentElement.classList.add("sheet-dragging");
  }

  _move(clientY) {
    const d = this._drag;
    if (!d) return;
    if (Math.abs(clientY - d.y) > 4) this._dragged = true;
    const now = performance.now();
    d.v = (clientY - d.last) / Math.max(1, now - d.lastT);
    d.last = clientY;
    d.lastT = now;
    const y = Math.max(0, Math.min(this.offsets().peek, d.y0 + clientY - d.y));
    this.root.style.transform = `translateY(${y}px)`;
    this._fade(y);
  }

  _end(clientY) {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    this.root.classList.remove("dragging");
    this.root.parentElement.classList.remove("sheet-dragging");
    this.root.style.transform = "";
    if (this._dragged) this.set(snapState(this.offsets(), d.y0 + clientY - d.y, d.v));
    else this._apply();
    setTimeout(() => { this._dragged = false; }, 0);   // the click that follows a drag shouldn't also step
  }

  _initDrag() {
    // The grip: always drags (mouse, pen or finger).
    this.grip.addEventListener("pointerdown", (e) => {
      if (!this.active) return;
      this.grip.setPointerCapture(e.pointerId);
      this._begin(e.clientY);
    });
    this.grip.addEventListener("pointermove", (e) => this._move(e.clientY));
    this.grip.addEventListener("pointerup", (e) => this._end(e.clientY));
    this.grip.addEventListener("pointercancel", (e) => this._end(e.clientY));

    // The content, like a maps app: below full, a vertical swipe moves the sheet instead of
    // scrolling inside it. At full, the details scroll normally, and pulling down from the very
    // top lowers the sheet again.
    let t = null;
    this.root.addEventListener("touchstart", (e) => {
      if (!this.active || e.touches.length !== 1 || this.grip.contains(e.target)) { t = null; return; }
      t = { x: e.touches[0].clientX, y: e.touches[0].clientY, mode: null };
    }, { passive: true });
    this.root.addEventListener("touchmove", (e) => {
      if (!t) return;
      const touch = e.touches[0], dx = touch.clientX - t.x, dy = touch.clientY - t.y;
      if (!t.mode) {
        if (Math.hypot(dx, dy) < 8) return;
        const vertical = Math.abs(dy) > Math.abs(dx);
        const pullDown = this.state === "full" && dy > 0 && this.panel.scrollTop <= 0;
        const inField = e.target.closest?.("input, textarea, select");
        t.mode = vertical && !inField && (this.state !== "full" || pullDown) ? "sheet" : "scroll";
        if (t.mode === "sheet") this._begin(t.y);
      }
      if (t.mode === "sheet") { e.preventDefault(); this._move(touch.clientY); }
    }, { passive: false });
    const finish = (e) => {
      if (t?.mode === "sheet") this._end(e.changedTouches[0].clientY);
      t = null;
    };
    this.root.addEventListener("touchend", finish);
    this.root.addEventListener("touchcancel", finish);
  }
}
