// Kinroot tree page: wires the 3D scene, side panel, search and time-lapse together.
import { createApi } from "./tree/api.js";
import { computeLayout } from "./tree/layout.js";
import { Panel } from "./tree/panel.js";
import { Search } from "./tree/search.js";
import { Timelapse } from "./tree/timelapse.js";
import { download, sleep, slug } from "./tree/util.js";

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
    s.layout = computeLayout(s.people, s.rels);
    s.fam = s.layout.fam;
    if (s.selected && !s.byId.has(s.selected)) s.selected = null;
    if (this.focusId && !s.byId.has(this.focusId)) this.focusId = null;
    $("empty-scene").hidden = s.people.length > 0;
    // Search, time-lapse, relationships and views have nothing to work on in an empty tree: show them once someone's there.
    for (const el of [$("btn-grow"), $("btn-relate"), $("btn-flat"), $("btn-reset"), document.querySelector(".scene-toolbar .search")]) {
      if (el) el.hidden = s.people.length === 0;
    }
    this.search.update(s.people);
    if (this.timelapse.isOpen) this.timelapse.close();
    if (this.scene) {
      this.scene.build({ people: s.people, layout: s.layout, meId: s.me.id });
      if (reframe) this.scene.frameAll();
      this.emphasize();
    }
  },

  emphasize() {
    if (!this.scene) return;
    const keep = this.pathIds ? new Set(this.pathIds) : this.focusId ? branchOf(this.focusId, this.store.fam) : null;
    this.scene.emphasize({ keep, selected: this.store.selected, path: this.pathIds });
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
        try { await onAction(); } catch (e) { /* leave the toast; the panel shows errors */ }
        this.dismissToast();
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
    this._toastTimer = setTimeout(() => this.dismissToast(), 8000);
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
    this.panel.person(id);
    if (fly && this.scene) this.scene.flyTo(id);
  },

  deselect() {
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
    if (!open) this.emphasize();
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
  $("btn-grow").addEventListener("click", () => app.timelapse.open());
  $("btn-relate").addEventListener("click", () => app.panel.relate());
  $("btn-add")?.addEventListener("click", () => app.panel.personForm({ mode: "add" }));
  const flat = $("btn-flat");
  flat.addEventListener("click", () => {
    if (!app.scene) return;
    const on = flat.getAttribute("aria-pressed") !== "true";
    flat.setAttribute("aria-pressed", on);
    flat.querySelector(".label").textContent = on ? "3D view" : "Flat view";
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
  app.search = new Search($("search-input"), $("search-results"), (id) => app.select(id, { fly: true }));
  app.timelapse = new Timelapse(app, $("timelapse"));
  wireToolbar();

  try {
    const { TreeScene } = await import("./tree/scene.js");
    app.scene = new TreeScene($("scene"), { onPick: (id) => (id ? app.select(id, { fly: true }) : null) });
    // Wait (briefly) for the Alegreya font so initials on the medallions use it.
    await Promise.race([document.fonts?.load?.('800 100px "Alegreya"'), sleep(1500)]).catch(() => {});
    await app.scene.loadModels(CFG.modelsBase);
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
      <button type="button" class="btn-sm" data-retry style="margin-top:8px">Try again</button></div>`;
    panel.querySelector("[data-msg]").textContent = err.message;
    panel.querySelector("[data-retry]").addEventListener("click", () => location.reload());
  } finally {
    $("scene-loading").hidden = true;
  }
  window.kinroot = app;   // handy for poking around in the browser console
}

boot();
