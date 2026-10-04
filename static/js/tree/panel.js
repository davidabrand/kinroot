// The side panel next to the 3D tree: overview, a person's details,
// add/edit forms, and "How are we related?".
import { lifespan } from "./util.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fullName = (p) => [p.first_name, p.last_name].filter(Boolean).join(" ");
const initials = (p) => ((p.first_name || "?")[0] + (p.last_name ? p.last_name[0] : "")).toUpperCase();
const ISSUE_TAG = { impossible: "Impossible", unlikely: "Unlikely" };
const issueItem = (i) => `<li><span class="issue-tag ${i.level === "impossible" ? "impossible" : ""}">${ISSUE_TAG[i.level] || "Check"}<span class="sr-only">:</span></span><span>${esc(i.text)}</span></li>`;

export class Panel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.view = "overview";
  }

  get store() { return this.app.store; }

  render(html) {
    this.el.removeAttribute("aria-busy");
    this.el.innerHTML = html;
    this.el.scrollTop = 0;
    // A soft fade when you move to a different view or person; a refresh of the same view stays still.
    const key = `${this.view}:${this.store.selected ?? ""}`;
    if (key !== this._lastKey) {
      this.el.classList.remove("entering");
      void this.el.offsetWidth;            // restart the animation
      this.el.classList.add("entering");
      this._lastKey = key;
    }
  }

  on(selector, event, fn) {
    this.el.querySelectorAll(selector).forEach((node) => node.addEventListener(event, fn));
  }

  // Runs an async action, showing any error message in the panel's error line.
  guard(fn) {
    return async (e) => {
      e?.preventDefault?.();
      const err = this.el.querySelector(".error");
      if (err) err.textContent = "";
      const button = e?.submitter || (e?.currentTarget instanceof HTMLButtonElement ? e.currentTarget : null);
      if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }   // same spinner as page forms
      try {
        await fn(e);
      } catch (ex) {
        const line = this.el.querySelector(".error");
        if (line) line.textContent = ex.message;
        else alertInline(this.el, ex.message);
      } finally {
        if (button && button.isConnected) { button.disabled = false; button.removeAttribute("aria-busy"); }
      }
    };
  }

  // ------------------------------------------------------------ overview
  overview() {
    this.view = "overview";
    const { people, tree, me, canEdit, isOwner, layout } = this.store;
    const years = people.map((p) => p.birth_year).filter(Boolean);
    const gens = people.length ? layout.maxGen + 1 : 0;
    const sorted = [...people].sort((a, b) => fullName(a).localeCompare(fullName(b)));
    const flagged = sorted.filter((p) => p.issues?.length);
    // The tree's name is already on the scene, so the panel opens straight on the numbers.
    this.render(`
      ${people.length ? `<h2 class="sr-only">Overview of ${esc(tree.name)}</h2>
      <dl class="stat-row">
        <div class="stat"><dt>People</dt><dd>${people.length}</dd></div>
        <div class="stat"><dt>${gens === 1 ? "Generation" : "Generations"}</dt><dd>${gens}</dd></div>
        <div class="stat"><dt>Earliest</dt><dd>${years.length ? Math.min(...years) : "–"}</dd></div>
      </dl>` : `<h2>An empty tree, ready to grow</h2>`}
      ${people.length ? `
        <div class="btn-row">
          <button class="btn-primary" data-act="grow">▶ Watch it grow</button>
          <button data-act="relate">How are we related?</button>
        </div>` : canEdit ? `
        <p class="muted">Start with yourself, or with the oldest relative you know. Then add parents, partners and children from there.</p>
        <div class="btn-row"><button class="btn-primary" data-act="add-self">Add myself</button><button data-act="add">Add someone else</button></div>` : `
        <p class="muted">Nobody has been added yet. Check back soon.</p>`}
      ${people.length && !me.person_id ? `
        <div class="account-card"><div class="grow"><strong>Which leaf is you?</strong><br>
          <span class="small muted">Click yourself on the tree and choose “This is me” so relatives can find and message you.</span></div></div>` : ""}
      ${canEdit && flagged.length ? `
        <details class="issues">
          <summary>${flagged.length === 1 ? "1 person has" : `${flagged.length} people have`} dates worth a second look</summary>
          <ul class="rel-list">
            ${flagged.map((p) => `<li><span><button class="who" data-goto="${p.id}">${esc(fullName(p))}</button>
              <span class="small muted issue-summary">${esc(p.issues[0].text)}${p.issues.length > 1 ? ` (+${p.issues.length - 1} more)` : ""}</span></span></li>`).join("")}
          </ul>
        </details>` : ""}
      ${isOwner ? `<p class="small muted">Want help filling it in? <a href="${esc(this.app.CFG.shareUrl)}">Invite family with a link</a>.</p>` : ""}
      ${people.length ? `
        <details>
          <summary>Everyone on this tree (${people.length})</summary>
          <ul class="rel-list">
            ${sorted.map((p) => `<li><button class="who" data-goto="${p.id}">${esc(fullName(p))}</button><span class="muted small">${esc(lifespan(p))}</span></li>`).join("")}
          </ul>
        </details>
        <p class="small muted touch-tip">Drag to move around, pinch to zoom, tap a portrait. Pull this sheet up for more.</p>` : ""}`);
    this.on("[data-act=grow]", "click", () => this.app.timelapse.open());
    this.on("[data-act=relate]", "click", () => this.relate());
    this.on("[data-act=add]", "click", () => this.personForm({ mode: "add" }));
    this.on("[data-act=add-self]", "click", () => this.personForm({ mode: "add", self: true }));
    this.on("[data-goto]", "click", (e) => this.app.select(Number(e.currentTarget.dataset.goto), { fly: true }));
  }

  // ------------------------------------------------------------ while the family grows
  grow() {
    this.view = "grow";
    this.render(`
      <p class="eyebrow">Watch it grow</p>
      <p class="grow-year num" data-grow-year>—</p>
      <p class="grow-count" data-grow-count></p>
      <ol class="grow-events" data-grow-events aria-live="polite"></ol>
      <p class="small muted">A second, finer ring marks relatives who have passed. Drag the year to move through time.</p>`);
  }

  growUpdate({ year, born, total, recent }) {
    if (this.view !== "grow") return;
    const q = (s) => this.el.querySelector(s);
    q("[data-grow-year]").textContent = year;
    q("[data-grow-count]").textContent = `${born} of ${total} ${total === 1 ? "person" : "people"} born so far`;
    q("[data-grow-events]").innerHTML = recent.slice().reverse()
      .map((e) => `<li>${e.year ? `<span class="num">${e.year}</span>` : ""}${esc(e.text)}</li>`).join("");
  }

  // ------------------------------------------------------------ one person
  person(id) {
    const p = this.store.byId.get(id);
    if (!p) return this.overview();
    this.view = "person";
    const { fam, byId, canEdit, isOwner, me, rels } = this.store;
    const parentCount = (fam.parents.get(id) || []).length;
    const relRow = (otherId, relId) => {
      const o = byId.get(otherId);
      if (!o) return "";
      return `<li><button class="who" data-goto="${o.id}">${esc(fullName(o))}</button>
        ${canEdit && relId ? `<button class="linklike danger small" data-unlink="${relId}" aria-label="Unlink ${esc(fullName(o))}">Unlink</button>` : ""}</li>`;
    };
    // Relatives grouped by kind, each group labelled once ("Children", not "Child" on every row).
    const groups = { parents: [], partners: [], children: [], siblings: [] };
    for (const r of rels) {
      if (r.kind === "parent" && r.person_b === id) groups.parents.push(relRow(r.person_a, r.id));
      else if (r.kind === "parent" && r.person_a === id) groups.children.push(relRow(r.person_b, r.id));
      else if (r.kind === "spouse" && (r.person_a === id || r.person_b === id)) groups.partners.push(relRow(r.person_a === id ? r.person_b : r.person_a, r.id));
    }
    const siblings = new Set();
    for (const par of fam.parents.get(id) || []) for (const c of fam.children.get(par) || []) if (c !== id) siblings.add(c);
    for (const s of siblings) groups.siblings.push(relRow(s, null));
    const LABELS = { parents: ["Parent", "Parents"], partners: ["Partner", "Partners"], children: ["Child", "Children"], siblings: ["Sibling", "Siblings"] };
    const rows = Object.entries(groups).filter(([, list]) => list.length).map(([key, list]) =>
      `<div class="rel-group"><span class="kind">${LABELS[key][list.length === 1 ? 0 : 1]}</span><ul class="rel-list">${list.join("")}</ul></div>`);

    const facts = [["Born", p.birth_display], ["Birthplace", p.birth_place], ["Died", p.death_display]]
      .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");
    const photo = p.photo_url
      ? `<img class="portrait" src="${esc(p.photo_url)}" alt="Photo of ${esc(fullName(p))}">`
      : `<div class="portrait initials" aria-hidden="true">${esc(initials(p))}</div>`;
    const focusOn = this.app.focusId === id;
    const familyCount = Object.values(groups).reduce((n, list) => n + list.length, 0);
    const tab = this.tab || "overview";
    const tabBtn = (key, label) => `<button type="button" role="tab" id="tab-${key}" aria-controls="pane-${key}" aria-selected="${tab === key}" tabindex="${tab === key ? 0 : -1}" data-tab="${key}">${label}</button>`;

    // "Life": a small timeline from real dates only — born, children born, died.
    const life = [];
    if (p.birth_year) life.push({ year: p.birth_year, text: `Born${p.birth_place ? ` in ${esc(p.birth_place)}` : ""}`, when: p.birth_display });
    for (const r of rels) {
      if (r.kind !== "parent" || r.person_a !== id) continue;
      const c = byId.get(r.person_b);
      if (c?.birth_year) life.push({ year: c.birth_year, text: `${esc(c.first_name)} is born`, when: c.birth_display, goto: c.id });
    }
    if (p.death_year) life.push({ year: p.death_year, text: "Passed away", when: p.death_display });
    life.sort((x, y) => x.year - y.year);
    const lifeHtml = life.length
      ? `<ol class="life">${life.map((e) => `<li><span class="life-year">${e.year}</span><span>${e.goto ? `<button class="who" data-goto="${e.goto}">${e.text}</button>` : e.text}${e.when && String(e.when) !== String(e.year) ? `<small>${esc(e.when)}</small>` : ""}</span></li>`).join("")}</ol>`
      : `<div class="empty"><strong>No dates yet</strong><span>${p.private ? `${esc(p.first_name)} is living, so dates are only shown to people who can edit this tree.` : "Add a birth date and their life will start to take shape here."}</span></div>`;

    this.render(`
      <p><button class="linklike" data-act="back">← Overview</button></p>
      <header class="person-head">
        ${photo}
        <div class="person-id">
          <p class="person-rel" data-rel hidden></p>
          <h2>${esc(fullName(p))}</h2>
          ${lifespan(p) ? `<p class="person-dates">${esc(lifespan(p))}${p.deceased ? ` <span>· remembered</span>` : ""}</p>` : ""}
        </div>
      </header>
      <div class="person-actions">
        ${canEdit ? `<button class="btn-sm btn-primary" data-act="edit">Edit</button>` : ""}
        ${me.person_id && me.person_id !== id ? `<button class="btn-sm" data-act="relate-me">How are we related?</button>`
          : `<button class="btn-sm" data-act="relate-from">Compare with…</button>`}
        <button class="btn-sm" data-act="focus" aria-pressed="${focusOn}">${focusOn ? "Show everyone" : "Focus branch"}</button>
      </div>
      ${this.accountCard(p)}
      <div class="tabs" role="tablist" aria-label="About ${esc(p.first_name)}">
        ${tabBtn("overview", "Overview")}${tabBtn("family", `Family${familyCount ? ` <span class="num">${familyCount}</span>` : ""}`)}${tabBtn("life", "Life")}
      </div>

      <section class="tab-pane stack" role="tabpanel" id="pane-overview" aria-labelledby="tab-overview" ${tab === "overview" ? "" : "hidden"}>
        ${facts ? `<dl class="facts">${facts}</dl>` : ""}
        ${p.private ? `<p class="small muted">${esc(p.first_name)} is living, so their dates and places are only shown to people who can edit this tree.</p>` : ""}
        ${p.issues?.length ? `
          <section class="issues stack-sm" aria-labelledby="issues-h">
            <h3 id="issues-h">Worth a second look</h3>
            <ul class="issue-list">${p.issues.map(issueItem).join("")}</ul>
            <p class="small muted">Fix a date with <b>Edit</b>, or leave it if the records really say so. Only people who can edit this tree see these notes.</p>
          </section>` : ""}
        ${p.notes ? `<p class="person-notes">${esc(p.notes).replace(/\n/g, "<br>")}</p>` : (!facts && !p.private ? `<div class="empty"><strong>Every life has a story</strong><span>${canEdit ? "Add dates, a birthplace or the stories people tell with <b>Edit</b>." : "Nothing has been written down here yet."}</span></div>` : "")}
        ${isOwner && !p.account ? `<p class="small muted"><a href="${esc(this.app.CFG.shareUrl)}?person=${id}">Invite ${esc(p.first_name)} to claim this leaf</a></p>` : ""}
        ${canEdit ? `<div><button class="btn-ghost btn-sm text-danger" data-act="delete">Remove from tree</button></div>` : ""}
      </section>

      <section class="tab-pane stack" role="tabpanel" id="pane-family" aria-labelledby="tab-family" ${tab === "family" ? "" : "hidden"}>
        ${rows.length ? rows.join("") : `<div class="empty"><strong>No relatives linked yet</strong><span>${canEdit ? "Add a parent, partner or child below." : ""}</span></div>`}
        ${canEdit ? `
          <div class="stack-sm">
            <h3>Add family</h3>
            <div class="chip-row">
              ${parentCount < 2 ? `<button class="btn-sm" data-add="parent">+ Parent</button>` : ""}
              <button class="btn-sm" data-add="spouse">+ Partner</button>
              <button class="btn-sm" data-add="child">+ Child</button>
              ${parentCount ? `<button class="btn-sm" data-add="sibling">+ Sibling</button>` : ""}
            </div>
            ${this.store.people.length > 1 ? `
            <details>
              <summary>Link someone already on the tree</summary>
              <div class="stack">
                <div class="field"><label for="link-kind">${esc(p.first_name)} is the…</label>
                  <select id="link-kind"><option value="parent">parent of</option><option value="child">child of</option><option value="spouse">partner of</option></select></div>
                <div class="field"><label for="link-other">Person</label>
                  <select id="link-other">${[...this.store.people].filter((o) => o.id !== id).sort((a, b) => fullName(a).localeCompare(fullName(b)))
                    .map((o) => `<option value="${o.id}">${esc(fullName(o))}</option>`).join("")}</select></div>
                <div><button class="btn-sm" data-act="link">Link them</button></div>
              </div>
            </details>` : ""}
          </div>` : ""}
      </section>

      <section class="tab-pane" role="tabpanel" id="pane-life" aria-labelledby="tab-life" ${tab === "life" ? "" : "hidden"}>
        ${lifeHtml}
      </section>
      <p class="error" role="alert"></p>`);

    // Tabs: click or arrow keys; the choice carries over as you move between people.
    const tabs = [...this.el.querySelectorAll("[role=tab]")];
    const showTab = (key, focus = false) => {
      this.tab = key;
      tabs.forEach((t) => {
        const on = t.dataset.tab === key;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        if (on && focus) t.focus();
        this.el.querySelector(`#pane-${t.dataset.tab}`).hidden = !on;
      });
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => showTab(t.dataset.tab));
      t.addEventListener("keydown", (e) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (step) { e.preventDefault(); showTab(tabs[(i + step + tabs.length) % tabs.length].dataset.tab, true); }
      });
    });

    // Your relationship to this person, named by Kinroot's own engine, once you've claimed your leaf.
    if (me.person_id && me.person_id !== id) {
      const key = `${me.person_id}:${id}`;
      const fill = (term) => {
        const el = this.el.querySelector("[data-rel]");
        if (el && term && this.store.selected === id) { el.textContent = `Your ${term}`; el.hidden = false; }
      };
      this._rel = this._rel || new Map();
      if (this._rel.has(key)) fill(this._rel.get(key));
      else this.app.api.relationship(me.person_id, id).then((r) => { this._rel.set(key, r?.term || ""); fill(r?.term); }).catch(() => {});
    } else if (me.person_id === id) {
      const el = this.el.querySelector("[data-rel]");
      el.textContent = "You";
      el.hidden = false;
    }

    this.on("[data-act=back]", "click", () => this.app.deselect());
    this.on("[data-goto]", "click", (e) => this.app.select(Number(e.currentTarget.dataset.goto), { fly: true }));
    this.on("[data-act=focus]", "click", () => this.app.toggleFocus(id));
    this.on("[data-act=relate-me]", "click", () => this.relate(me.person_id, id, true));
    this.on("[data-act=relate-from]", "click", () => this.relate(id, null));
    this.on("[data-add]", "click", (e) => this.personForm({ mode: "add", link: { to: id, as: e.currentTarget.dataset.add } }));
    this.on("[data-act=edit]", "click", () => this.personForm({ mode: "edit", person: p }));
    // No "are you sure?": removing is instant and the toast offers Undo, which is faster and just as safe.
    this.on("[data-act=delete]", "click", this.guard(async () => {
      const removedName = fullName(p);
      const res = await this.app.api.deletePerson(id);
      this.app.store.selected = null;
      await this.app.refresh();
      this.app.deselect();
      if (res && res.undo) {
        this.app.toast(`Removed ${removedName}.`, "Undo", async () => {
          const back = await this.app.api.restorePerson(res.undo);
          await this.app.refresh();
          if (back && back.person) this.app.select(back.person.id, { fly: true });
        });
      }
    }));
    this.on("[data-unlink]", "click", this.guard(async (e) => {
      const rel = rels.find((r) => r.id === Number(e.currentTarget.dataset.unlink));
      await this.app.api.unlink(rel.id);
      await this.app.refresh();
      this.person(id);
      // A mis-click shouldn't cost a relationship: offer to put the link straight back.
      const other = byId.get(rel.person_a === id ? rel.person_b : rel.person_a);
      this.app.toast(`Unlinked ${other ? fullName(other) : "them"}.`, "Undo", async () => {
        await this.app.api.link(rel.person_a, rel.person_b, rel.kind === "spouse" ? "spouse" : "parent");
        await this.app.refresh();
        if (this.store.selected === id) this.person(id);
      });
    }));
    this.on("[data-act=link]", "click", this.guard(async () => {
      const other = Number(this.el.querySelector("#link-other").value);
      await this.app.api.link(id, other, this.el.querySelector("#link-kind").value);
      await this.app.refresh();
      this.person(id);
      this.app.toast(`Linked ${fullName(p)} and ${fullName(byId.get(other) || { first_name: "them" })}.`);
    }));
    this.wireAccountCard(p);
  }

  accountCard(p) {
    const a = p.account;
    const { me } = this.store;
    if (!a) {
      return !me.person_id ? `
        <div class="account-card"><div class="grow"><strong>Is this you?</strong><br>
          <span class="small muted">Claim this leaf so relatives can connect with you.</span></div>
          <button class="btn-sm btn-primary" data-act="claim">This is me</button></div>` : "";
    }
    if (a.is_me) {
      return `<div class="account-card"><div class="grow"><strong>This is you</strong><br>
        <span class="small muted">Relatives on this tree can send you connection requests.</span></div>
        <button class="btn-sm btn-ghost" data-act="unclaim">Not me</button></div>`;
    }
    const first = esc(a.name.split(" ")[0]);
    const action = {
      none: `<button class="btn-sm btn-primary" data-act="connect">Connect</button>`,
      pending_out: `<span class="pill">Request sent</span>`,
      pending_in: `<a class="btn btn-sm btn-primary" href="/family">Answer ${first}'s request</a>`,
      connected: `<a class="btn btn-sm btn-primary" href="/family/${a.connection_id}">Message</a>`,
      unavailable: "",
    }[a.connection] || "";
    return `<div class="account-card"><div class="grow"><strong>${esc(a.name)} is on Kinroot</strong><br>
        <span class="small muted">${a.connection === "connected" ? "You're connected." : `Connect to message ${first}.`}</span></div>
        ${action}
        <form class="stack full-row" data-connect-form hidden>
          <label for="connect-note">Add a note <span class="hint">optional</span></label>
          <textarea id="connect-note" maxlength="300" placeholder="Hi ${first}! I found you on the family tree."></textarea>
          <div class="btn-row"><button class="btn-primary btn-sm">Send request</button><button type="button" class="btn-sm btn-ghost" data-act="connect-cancel">Cancel</button></div>
        </form>
      </div>`;
  }

  wireAccountCard(p) {
    this.on("[data-act=claim]", "click", this.guard(async () => {
      await this.app.api.claim(p.id);
      await this.app.refresh();
      this.person(p.id);
    }));
    this.on("[data-act=unclaim]", "click", this.guard(async () => {
      await this.app.api.unclaim(p.id);
      await this.app.refresh();
      this.person(p.id);
    }));
    const form = this.el.querySelector("[data-connect-form]");
    this.on("[data-act=connect]", "click", (e) => { form.hidden = false; e.currentTarget.hidden = true; form.querySelector("textarea").focus(); });
    this.on("[data-act=connect-cancel]", "click", () => { form.hidden = true; this.el.querySelector("[data-act=connect]").hidden = false; });
    form?.addEventListener("submit", this.guard(async () => {
      await this.app.api.connect(p.account.id, form.querySelector("textarea").value);
      await this.app.refresh();
      this.person(p.id);
    }));
  }

  // ------------------------------------------------------------ add / edit form
  personForm({ mode, person = null, link = null, self = false }) {
    // (`link` may be updated on submit to follow the relationship chosen in the form.)
    this.app.sheet?.raise("full");            // phones: a form needs the whole sheet
    this.view = "form";
    const { byId, me } = this.store;
    const other = link ? byId.get(link.to) : null;
    const v = (k) => esc(person?.[k] ?? "");
    const AS_WORD = { parent: "a parent", child: "a child", spouse: "a partner", sibling: "a sibling" };
    const heading = mode === "edit" ? `Edit ${esc(fullName(person))}`
      : other ? `Add ${AS_WORD[link.as] || "a relative"} for ${esc(other.first_name)}`
      : self ? "Add yourself" : "Add a person";
    // Who they are to someone already on the tree. Offered on every add; preset when you came from a person's panel.
    const everyone = [...this.store.people].sort((a, b) => fullName(a).localeCompare(fullName(b)));
    const relKind = link?.as || "";
    const relTo = link?.to ?? this.store.selected ?? me.person_id ?? everyone[0]?.id;
    const relationField = mode === "add" && everyone.length ? `
        <fieldset class="relation-field">
          <legend>How are they related?</legend>
          <div class="two-col">
            <div class="field"><label for="f-rel-kind">They are the…</label>
              <select id="f-rel-kind">
                <option value="" ${relKind ? "" : "selected"}>Not connected yet</option>
                <option value="parent" ${relKind === "parent" ? "selected" : ""}>parent of</option>
                <option value="child" ${relKind === "child" ? "selected" : ""}>child of</option>
                <option value="spouse" ${relKind === "spouse" ? "selected" : ""}>partner of</option>
                <option value="sibling" ${relKind === "sibling" ? "selected" : ""}>sibling of</option>
              </select></div>
            <div class="field"><label for="f-rel-to">Person</label>
              <select id="f-rel-to">${everyone.map((o) => `<option value="${o.id}" ${o.id === relTo ? "selected" : ""}>${esc(fullName(o))}</option>`).join("")}</select></div>
          </div>
          <div class="field" data-other-parent hidden><label for="f-rel-other">Other parent <span class="hint">so the child comes from both</span></label>
            <select id="f-rel-other"></select></div>
          <p class="hint" data-rel-hint></p>
        </fieldset>` : "";
    // Smart defaults: adding yourself starts with your account name; a child starts with the parent's last name.
    const [myFirst, ...myRest] = self ? (me.name || "").trim().split(/\s+/) : [];
    const presetFirst = self ? esc(myFirst || "") : "";
    const presetLast = self ? esc(myRest.join(" ")) : other && link.as === "child" ? esc(other.last_name) : "";
    const genders = ["female", "male", "non-binary"];
    // Birthplace, notes and photo are optional extras: tucked away when adding, open when editing someone who has them.
    const extrasOpen = mode === "edit" && (person.birth_place || person.notes || person.photo_url);
    this.render(`
      <p><button class="linklike" data-act="back">← Back</button></p>
      <h2>${heading}</h2>
      <form class="stack" data-form>
        ${relationField}
        <div class="two-col">
          <div class="field"><label for="f-first">First name</label><input id="f-first" name="first_name" required maxlength="100" value="${mode === "edit" ? v("first_name") : presetFirst}" autocomplete="off"></div>
          <div class="field"><label for="f-last">Last name</label><input id="f-last" name="last_name" maxlength="100" value="${mode === "edit" ? v("last_name") : presetLast}" autocomplete="off"></div>
        </div>
        <div class="two-col">
          <div class="field"><label for="f-born">Born</label><input id="f-born" name="birth_date" value="${mode === "edit" ? v("birth_display") : ""}" placeholder="2 Mar 1921" autocomplete="off"></div>
          <div class="field"><label for="f-died">Died</label><input id="f-died" name="death_date" value="${mode === "edit" ? v("death_display") : ""}" placeholder="leave blank if living" autocomplete="off"></div>
        </div>
        <p class="date-hint">Exact dates, just a year, or “about 1921” all work.</p>
        <label class="check"><input type="checkbox" name="deceased" id="f-deceased" ${person?.deceased ? "checked" : ""}> Has passed away</label>
        <div class="field"><label for="f-gender">Gender <span class="hint">helps name relationships (aunt, uncle…)</span></label>
          <input id="f-gender" name="gender" list="gender-options" maxlength="30" value="${mode === "edit" ? v("gender") : ""}">
          <datalist id="gender-options">${genders.map((g) => `<option value="${g}">`).join("")}</datalist></div>
        <details class="more-details" ${extrasOpen ? "open" : ""}>
          <summary>More details <span class="hint">birthplace, photo, stories</span></summary>
          <div class="stack">
            <div class="field"><label for="f-place">Birthplace</label><input id="f-place" name="birth_place" maxlength="200" value="${mode === "edit" ? v("birth_place") : ""}" placeholder="Brooklyn, New York"></div>
            <div class="field"><label for="f-photo">Photo</label><input id="f-photo" name="photo" type="file" accept="image/jpeg,image/png,image/gif,image/webp">
              ${mode === "edit" && person.photo_url ? `<label class="check small"><input type="checkbox" id="f-photo-remove"> Remove the current photo</label>` : ""}</div>
            <div class="field"><label for="f-notes">Notes and stories</label><textarea id="f-notes" name="notes" maxlength="5000" placeholder="Where they lived, what they did, the stories people tell">${mode === "edit" ? v("notes") : ""}</textarea></div>
          </div>
        </details>
        ${mode === "add" && !me.person_id && !link ? `<label class="check"><input type="checkbox" id="f-self" ${self ? "checked" : ""}> This is me</label>` : ""}
        <div class="btn-row"><button class="btn-primary">${mode === "edit" ? "Save changes" : "Add to tree"}</button></div>
        <p class="error" role="alert"></p>
      </form>`);

    const form = this.el.querySelector("[data-form]");
    const died = form.querySelector("#f-died"), deceased = form.querySelector("#f-deceased");
    const kindSel = form.querySelector("#f-rel-kind"), toSel = form.querySelector("#f-rel-to");
    const otherWrap = form.querySelector("[data-other-parent]"), otherSel = form.querySelector("#f-rel-other");
    const relHint = form.querySelector("[data-rel-hint]");
    const syncRelation = () => {
      if (!kindSel) return;
      const kind = kindSel.value, to = Number(toSel.value), target = byId.get(to);
      toSel.disabled = !kind;
      const fam = this.store.fam;
      // A child: also ask for the other parent; preselect when there's exactly one partner.
      const partners = (fam.spouses.get(to) || []).map((id) => byId.get(id)).filter(Boolean);
      otherWrap.hidden = kind !== "child";
      if (kind === "child") {
        otherSel.innerHTML = `<option value="">Not recorded</option>` +
          partners.map((o) => `<option value="${o.id}" ${partners.length === 1 ? "selected" : ""}>${esc(fullName(o))}</option>`).join("");
      }
      const parents = fam.parents.get(to) || [];
      relHint.textContent = kind === "sibling"
        ? (parents.length ? `They'll share ${parents.map((id) => byId.get(id)?.first_name).join(" and ")} as parents.`
          : `${target?.first_name || "They"} has no parents on the tree yet. Add a parent first, then add siblings.`)
        : kind === "parent" && parents.length >= 2 ? `${target?.first_name} already has two parents on the tree.` : "";
      // Pre-fill a child's surname from the parent when it's still empty.
      const last = form.querySelector("#f-last");
      if (kind === "child" && !last.value && target?.last_name) last.value = target.last_name;
    };
    kindSel?.addEventListener("change", syncRelation);
    toSel?.addEventListener("change", syncRelation);
    syncRelation();
    died.addEventListener("input", () => { if (died.value.trim()) deceased.checked = true; });
    this.on("[data-act=back]", "click", () => (person ? this.person(person.id) : other ? this.person(other.id) : this.overview()));
    form.addEventListener("submit", this.guard(async () => {
      const data = Object.fromEntries(["first_name", "last_name", "birth_date", "death_date", "birth_place", "gender", "notes"]
        .map((k) => [k, form.elements[k].value]));
      data.deceased = deceased.checked;
      let saved;
      if (mode === "edit") {
        saved = (await this.app.api.updatePerson(person.id, data)).person;
      } else {
        const kind = kindSel?.value || "", to = Number(toSel?.value);
        const siblingParents = kind === "sibling" ? (this.store.fam.parents.get(to) || []) : [];
        if (kind === "sibling" && !siblingParents.length) {
          throw new Error(`${byId.get(to)?.first_name || "They"} has no parents on the tree yet, so there's no one for a sibling to share. Add a parent first.`);
        }
        if (kind && kind !== "sibling") data.link = { to, as: kind };
        saved = (await this.app.api.addPerson(data)).person;
        // Siblings share the same parents; a child can come from both parents.
        // The person exists now, so a failed extra link must not leave the form open (saving again would add them twice).
        const extra = [...siblingParents.map((parent) => [parent, saved.id, "parent"]),
          ...(kind === "child" && otherSel?.value ? [[Number(otherSel.value), saved.id, "parent"]] : [])];
        try {
          for (const [a, b, as] of extra) await this.app.api.link(a, b, as);
          if (form.querySelector("#f-self")?.checked) await this.app.api.claim(saved.id);
        } catch (e) {
          await this.app.refresh();
          this.app.select(saved.id, { fly: true });
          this.app.toast(`Added ${fullName(saved)}, but not every link was saved: ${e.message} Use "Link someone already on the tree" to finish.`);
          return;
        }
        link = kind ? { to, as: kind } : null;          // so "return to who you were building around" follows the choice
      }
      const file = form.querySelector("#f-photo").files[0];
      if (file) await this.app.api.uploadPhoto(saved.id, file);
      else if (form.querySelector("#f-photo-remove")?.checked) await this.app.api.removePhoto(saved.id);
      await this.app.refresh({ reframe: mode === "add" && this.store.people.length <= 1 });
      // Adding a second parent? Link the two parents as a couple (the usual
      // case), so they sit together rather than looking like two separate roots.
      const anchor = link ? byId.get(link.to) : null;
      if (mode === "add" && link && link.as === "parent" && anchor) {
        const ps = this.store.fam.parents.get(anchor.id) || [];
        if (ps.length === 2 && !(this.store.fam.spouses.get(ps[0]) || []).includes(ps[1])) {
          try { await this.app.api.link(ps[0], ps[1], "spouse"); await this.app.refresh(); } catch (e) { /* non-fatal */ }
        }
      }
      // Return to the person you were building around, so you can add the other
      // parent or more children without accidentally chaining generations.
      const focusId = (mode === "add" && link && ["parent", "child", "sibling"].includes(link.as)) ? link.to : saved.id;
      this.app.select(focusId, { fly: mode === "add" });
      this.app.toast(mode === "edit" ? `Saved ${fullName(saved)}.` : `Added ${fullName(saved)} to the tree.`);
    }));
    form.querySelector(self && presetFirst ? "#f-born" : "#f-first").focus();   // name already filled? start at the date
  }

  // ------------------------------------------------------------ how are we related?
  relate(a = null, b = null, auto = false) {
    this.app.sheet?.raise("half");
    this.view = "relate";
    const { people, me } = this.store;
    const sorted = [...people].sort((x, y) => fullName(x).localeCompare(fullName(y)));
    const first = a ?? me.person_id ?? this.store.selected ?? sorted[0]?.id;
    const second = b ?? (this.store.selected && this.store.selected !== first ? this.store.selected : sorted.find((p) => p.id !== first)?.id);
    const options = (sel) => sorted.map((p) => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(fullName(p))}${p.account?.is_me ? " (you)" : ""}</option>`).join("");
    this.render(`
      <p><button class="linklike" data-act="back">← Back</button></p>
      <h2>How are we related?</h2>
      <p class="muted small">Pick two people. Kinroot names the relationship and lights up the path between them on the tree.</p>
      <form class="stack" data-relate>
        <div class="field"><label for="rel-a">From</label><select id="rel-a">${options(first)}</select></div>
        <div class="field"><label for="rel-b">To</label><select id="rel-b">${options(second)}</select></div>
        <div><button>Show me</button></div>
      </form>
      <div data-result aria-live="polite"></div>
      <p class="error" role="alert"></p>`);
    this.on("[data-act=back]", "click", () => {
      this.app.clearPath();
      this.store.selected ? this.person(this.store.selected) : this.overview();
    });
    const form = this.el.querySelector("[data-relate]");
    const run = this.guard(async () => {
      const A = Number(form.querySelector("#rel-a").value), B = Number(form.querySelector("#rel-b").value);
      const res = await this.app.api.relationship(A, B);
      const byId = this.store.byId;
      const box = this.el.querySelector("[data-result]");
      box.innerHTML = `
        <div class="result-card">
          <p class="big">${esc(res.sentence)}</p>
          ${res.path?.length > 1 ? `<div class="path">${res.path.map((id) => `<span>${esc(byId.get(id)?.first_name || "?")}</span>`).join('<span class="arrow">→</span>')}</div>
          <p class="small muted">The glowing branches show how you're connected.</p>` : ""}
        </div>`;
      this.app.showPath(res.path || []);
    });
    form.addEventListener("submit", run);
    // Answer straight away when two different people are already picked, and again whenever either changes.
    const ready = () => form.querySelector("#rel-a").value !== form.querySelector("#rel-b").value;
    form.addEventListener("change", () => { if (ready()) run(); });
    if (auto || (first && second && ready())) run();
  }
}

function alertInline(root, message) {
  const p = document.createElement("p");
  p.className = "error";
  p.setAttribute("role", "alert");
  p.textContent = message;
  root.appendChild(p);
}
