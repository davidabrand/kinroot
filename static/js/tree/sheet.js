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

  // How many pixels of the tree the sheet is covering right now.
  covered() {
    if (!this.active) return 0;
    return Math.max(0, this.root.offsetHeight - this.offsets()[this.state]);
  }

  _apply() {
    this.root.dataset.sheet = this.active ? this.state : "";
    const open = this.state !== "peek";
    this.grip.setAttribute("aria-expanded", String(open));
    this.grip.setAttribute("aria-label", this.state === "full" ? "Lower the details" : "Show more details");
    this.onChange(this.covered());
  }

  _initDrag() {
    let start = null;
    this.grip.addEventListener("pointerdown", (e) => {
      if (!this.active) return;
      const y0 = this.offsets()[this.state];
      start = { y: e.clientY, y0, t: performance.now(), last: e.clientY, lastT: performance.now(), v: 0 };
      this._dragged = false;
      this.grip.setPointerCapture(e.pointerId);
      this.root.classList.add("dragging");
    });
    this.grip.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dy = e.clientY - start.y;
      if (Math.abs(dy) > 4) this._dragged = true;
      const now = performance.now();
      start.v = (e.clientY - start.last) / Math.max(1, now - start.lastT);
      start.last = e.clientY;
      start.lastT = now;
      const y = Math.max(0, Math.min(this.offsets().peek, start.y0 + dy));
      this.root.style.transform = `translateY(${y}px)`;
    });
    const end = (e) => {
      if (!start) return;
      const y = start.y0 + (e.clientY - start.y);
      const v = start.v;
      start = null;
      this.root.classList.remove("dragging");
      this.root.style.transform = "";
      if (this._dragged) this.set(snapState(this.offsets(), y, v));
      setTimeout(() => { this._dragged = false; }, 0);   // the click that follows a drag shouldn't also step
    };
    this.grip.addEventListener("pointerup", end);
    this.grip.addEventListener("pointercancel", end);
  }
}
