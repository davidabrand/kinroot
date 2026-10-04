// Kinroot tree page: wires the 3D scene, side panel, search and time-lapse together.
import { createApi } from "./tree/api.js";
import { computeLayout } from "./tree/layout.js";
import { Panel } from "./tree/panel.js";
import { filterSet, FILTERS } from "./tree/filters.js";
import { Search } from "./tree/search.js";
import { Sheet } from "./tree/sheet.js";
import { Timelapse } from "./tree/timelapse.js";
import { download, slug } from "./tree/util.js";

const CFG = window.KINROOT;
const $ = (id) => document.getElementById(id);

const app = {
  CFG,
  api: createApi(CFG.treeId),
  scene: null,
  focusId: null,
  pathIds: null,
  store: { tree: { name: "" }, role: "viewer", me: {}, people: [], rels: [], byId: new Map(), selected: null },

  async refresh({ reframe = false } = {}) {
    const data = await this.api.load();
    const s = this.store;
    Object.assign(s, {
      tree: data.tree, role: data.role, me: data.me, people: data.people, rels: data.relationships,
      byId: new Map(data.people.map((p) => [p.id, p])),
      canEdit: data.role === "editor" || data.role === "owner", isOwner: data.role === "owner",
    });
    // "Unknown" parent slots beside you and your parents, where a parent can be added (editors only).
    const mine = s.me.person_id;
    const parentsOf = (id) => s.rels.filter((r) => r.kind === "parent" && r.person_b === id).map((r) => r.person_a);
    const unknownFor = s.canEdit && mine && s.byId.has(mine) ? [mine, ...parentsOf(mine)] : [];
    s.layout = computeLayout(s.people, s.rels, { meId: mine, unknownFor });
    s.fam = s.layout.fam;
    if (s.selected && !s.byId.has(s.selected)) s.selected = null;
    if (this.focusId && !s.byId.has(this.focusId)) this.focusId = null;
    $("empty-scene").hidden = s.people.length > 0;
    // Search, time-lapse, relationships and views have nothing to work on in an empty tree: show them once someone's there.
    for (const el of [$("btn-grow"), $("btn-relate"), $("btn-flat"), document.querySelector(".cam-controls"), document.querySelector(".tree-bar .search"), document.querySelector(".tool-select")]) {
      if (el) el.hidden = s.people.length === 0;
    }
    $("btn-me").hidden = !s.me.person_id;   // "Centre on me" once you've claimed your leaf
    this.search.update(s.people);
    if (this.timelapse.isOpen) this.timelapse.close();
    if (this.scene) {
      this.scene.build({ people: s.people, layout: s.layout, meId: mine, canEdit: s.canEdit });
      if (reframe) this.scene.frameAll();
      this.emphasize();
    }
  },

  // Branch filter ("Show: Ancestors", ...), centred on the selected person, or on you.
  filter: "all",
  setFilter(mode) {
    this.filter = mode;
    const anchor = this.store.selected ?? this.store.me?.person_id;
    if (mode !== "all" && anchor == null) {
      this.toast("Select someone on the tree first, then choose which part of their family to show.");
      this.filter = "all";
      document.getElementById("branch-filter").value = "all";
      return;
    }
    this.emphasize();
    const keep = filterSet(mode, anchor, this.store.fam, this.store.byId);
    if (keep && keep.size > 1) this.scene?.frameIds([...keep]); else if (!keep) this.scene?.frameAll();
    if (keep) this.toast(`Showing ${FILTERS[mode].toLowerCase()} of ${this.store.byId.get(anchor)?.first_name || "this person"}.`);
  },

  // Hovering a portrait brightens that person's lines (after a beat, so sweeping across them doesn't flicker).
  hover(id) {
    clearTimeout(this._hoverTimer);
    this._hoverTimer = setTimeout(() => {
      if (this.hoverId === id) return;
      this.hoverId = id;
      this.emphasize();
    }, id ? 140 : 60);
  },

  emphasize() {
    if (!this.scene) return;
    const anchor = this.store.selected ?? this.store.me?.person_id;
    const filtered = this.filter !== "all" ? filterSet(this.filter, anchor, this.store.fam, this.store.byId) : null;
    const keep = this.pathIds ? new Set(this.pathIds) : filtered ? filtered : this.focusId ? branchOf(this.focusId, this.store.fam) : null;
    // Hover only brightens that person's own lines a little; it never dims the rest of the family.
    this.scene.emphasize({ keep, selected: this.store.selected, path: this.pathIds, hover: this.hoverId });
  },

  // A brief message at the bottom of the screen, optionally with one action
  // (used for "Removed … — Undo"). Auto-dismisses after a few seconds.
  toast(message, actionLabel, onAction) {
    let host = document.getElementById("toast");
    if (!host) {
      host = document.createElement("div");
      host.id = "toast";
      host.className = "toast glass";
      host.setAttribute("role", "status");
      document.body.appendChild(host);
    }
    clearTimeout(this._toastTimer);
    host.textContent = "";
    const msg = document.createElement("span");
    msg.className = "toast-msg";
    msg.textContent = message;
    host.appendChild(msg);
    if (actionLabel && onAction) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-action";
      btn.textContent = actionLabel;
      btn.addEventListener("click", async () => {
        clearTimeout(this._toastTimer);
        btn.disabled = true;
        try {
          await onAction();
          this.dismissToast();
        } catch (e) {
          // Never let a failed Undo look like it worked: say so, and say what to do.
          this.toast(`Couldn't undo that: ${e.message}`);
        }
      });
      host.appendChild(btn);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "\u00d7";
    close.addEventListener("click", () => this.dismissToast());
    host.appendChild(close);
    host.classList.add("show");
    // Long enough to reach Undo; plain confirmations get out of the way sooner.
    this._toastTimer = setTimeout(() => this.dismissToast(), actionLabel ? 8000 : 4000);
  },

  dismissToast() {
    clearTimeout(this._toastTimer);
    document.getElementById("toast")?.classList.remove("show");
  },

  select(id, { fly = true } = {}) {
    if (!this.store.byId.has(id)) return;
    this.store.selected = id;
    if (this.focusId && this.focusId !== id && !branchOf(this.focusId, this.store.fam).has(id)) this.focusId = null;
    this.clearPath(false);
    this.emphasize();
    this.sheet?.raise("half");
    this.panel.person(id);
    if (fly && this.scene) this.scene.flyTo(id);
  },

  deselect() {
    this.sheet?.set("peek");
    this.store.selected = null;
    this.focusId = null;
    this.clearPath(false);
    this.emphasize();
    this.panel.overview();
  },

  toggleFocus(id) {
    this.focusId = this.focusId === id ? null : id;
    this.emphasize();
    this.panel.person(id);
  },

  showPath(path) {
    this.pathIds = path && path.length > 1 ? path : null;
    this.scene?.showPath(this.pathIds, this.store.fam);
    this.emphasize();
    if (this.pathIds && this.scene) this.scene.frameIds(this.pathIds);
  },

  clearPath(update = true) {
    if (!this.pathIds) return;
    this.pathIds = null;
    this.scene?.clearPath();
    if (update) this.emphasize();
  },

  onTimelapse(open) {
    document.body.classList.toggle("timelapse-on", open);
    const grow = document.getElementById("btn-grow");
    grow?.setAttribute("aria-pressed", String(open));
    grow?.querySelector(".label")?.replaceChildren(open ? "Stop" : "Watch it grow");
    if (open) { this.sheet?.set("peek"); this.panel.grow(); }
    else {
      this.emphasize();
      this.store.selected ? this.panel.person(this.store.selected) : this.panel.overview();
    }
    // Phones: the playback bar sits over the tree above the sheet, so framing keeps clear of it too.
    if (this.scene && this.sheet?.active) {
      const bar = document.getElementById("timelapse");
      this.scene.insetBottom = this.sheet.covered() + (open ? 12 + bar.offsetHeight : 0);
    }
  },
};

// Everyone in someone's line: their ancestors, their descendants, and those people's partners.
function branchOf(id, fam) {
  const keep = new Set([id]);
  const walk = (start, next) => {
    const stack = [start];
    while (stack.length) for (const n of next.get(stack.pop()) || []) if (!keep.has(n)) { keep.add(n); stack.push(n); }
  };
  walk(id, fam.parents);
  walk(id, fam.children);
  for (const n of [...keep]) for (const s of fam.spouses.get(n) || []) keep.add(s);
  return keep;
}

function wireToolbar() {
  $("btn-reset").addEventListener("click", () => app.scene?.frameAll());
  $("btn-orient").addEventListener("click", () => app.scene?.resetView());
  $("branch-filter").addEventListener("change", (e) => app.setFilter(e.target.value));
  $("btn-zoom-in").addEventListener("click", () => app.scene?.zoomBy(0.72));
  $("btn-zoom-out").addEventListener("click", () => app.scene?.zoomBy(1.38));
  $("btn-me").addEventListener("click", () => app.store.me.person_id && app.select(app.store.me.person_id, { fly: true }));
  $("btn-grow").addEventListener("click", () => (app.timelapse.isOpen ? app.timelapse.close() : app.timelapse.open()));
  $("btn-relate").addEventListener("click", () => app.panel.relate());
  $("btn-add")?.addEventListener("click", () => app.panel.personForm({ mode: "add" }));
  const flat = $("btn-flat");
  flat.addEventListener("click", () => {
    if (!app.scene) return;
    const on = flat.getAttribute("aria-pressed") !== "true";
    flat.setAttribute("aria-pressed", on);
    flat.querySelector(".label").textContent = on ? "3D" : "2D";
    flat.title = on ? "Back to the 3D tree" : "A flat, 2D view of the tree";
    app.scene.setFlat(on);
  });
  $("btn-picture").addEventListener("click", async () => {
    if (!app.scene) return;
    const blob = await app.scene.snapshot(app.store.tree.name);
    if (blob) download(blob, `${slug(app.store.tree.name)}.png`);
    closeMenu();
  });
  $("btn-blender").addEventListener("click", () => {
    if (!app.scene) return;
    const data = app.scene.exportForBlender(app.store.people, app.store.tree.name);
    download(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }), `${slug(app.store.tree.name)}-poster.json`);
    closeMenu();
  });
  const more = $("more-menu");
  const closeMenu = () => more.removeAttribute("open");
  document.addEventListener("pointerdown", (e) => { if (!more.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.target.closest?.("input, textarea, select")) return;
    if (more.open) closeMenu();
    else if (app.timelapse.isOpen) app.timelapse.close();
    else if (app.pathIds) { app.clearPath(); }
    else if (app.focusId) app.toggleFocus(app.focusId);
    else if (app.store.selected) app.deselect();
  });
}

async function boot() {
  app.panel = new Panel(app, $("panel"));
  // Phones: the panel is a bottom sheet; the tree keeps whoever you're looking at above it.
  app.sheet = new Sheet($("panel-sheet"), $("sheet-grip"), { onChange: (px) => app.scene?.setInsetBottom(px) });
  app.search = new Search($("search-input"), $("search-results"), (id) => app.select(id, { fly: true }));
  app.timelapse = new Timelapse(app, $("timelapse"));
  wireToolbar();

  try {
    const { TreeScene } = await import("./tree/scene.js");
    app.scene = new TreeScene($("scene"), {
      onPick: (id) => (id ? app.select(id, { fly: true }) : null),
      onHover: (id) => app.hover(id),
      // An "Unknown" parent slot: add that parent right there.
      onUnknown: (childId) => app.store.canEdit && app.panel.personForm({ mode: "add", link: { to: childId, as: "parent" } }),
    });
    app.scene.insetBottom = app.sheet.covered();
    // Phones: the toolbar floats over the top of the tree; keep people clear of it too.
    const bar = document.querySelector(".tree-bar");
    const topInset = () => { app.scene.insetTop = app.sheet.active && bar ? bar.offsetTop + bar.offsetHeight : 0; };
    topInset();
    new ResizeObserver(topInset).observe($("scene"));
  } catch (err) {
    console.error("Kinroot: 3D view unavailable", err);
    app.scene = null;
    $("scene-error").hidden = false;
  }

  try {
    await app.refresh({ reframe: true });
    app.panel.overview();
  } catch (err) {
    // Say what happened, that nothing is lost, and offer the obvious next step.
    const panel = $("panel");
    panel.removeAttribute("aria-busy");
    panel.innerHTML = `<div class="empty" role="alert"><strong>Your family couldn't load</strong>
      <span data-msg></span><span>Nothing has been lost. Check your connection, then try again.</span>
      <button type="button" class="btn-sm" data-retry>Try again</button></div>`;
    panel.querySelector("[data-msg]").textContent = err.message;
    panel.querySelector("[data-retry]").addEventListener("click", () => location.reload());
  } finally {
    $("scene-loading").hidden = true;
  }
  // The sidebar's Timeline / Relationships links open those modes (#timeline, #relate), also mid-visit.
  const openMode = () => {
    if (location.hash === "#timeline" && app.store.people.length) app.timelapse.open();
    else if (location.hash === "#relate" && app.store.people.length) app.panel.relate();
    else if (location.hash === "#add" && app.store.canEdit) app.panel.personForm({ mode: "add" });
    else if (location.hash.startsWith("#person-")) {          // from the People page: fly to them
      const id = Number(location.hash.slice(8));
      if (app.store.byId.has(id)) app.select(id, { fly: true });
    }
  };
  openMode();
  addEventListener("hashchange", openMode);
  window.kinroot = app;   // handy for poking around in the browser console
}

boot();
