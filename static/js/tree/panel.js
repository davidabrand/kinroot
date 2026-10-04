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
      if (button) button.disabled = true;
      try {
        await fn(e);
      } catch (ex) {
        const line = this.el.querySelector(".error");
        if (line) line.textContent = ex.message;
        else alertInline(this.el, ex.message);
      } finally {
        if (button && button.isConnected) button.disabled = false;
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
    this.render(`
      <div class="panel-head">
        <p class="eyebrow">${esc(tree.name)}</p>
        <h2>${people.length ? "Your family at a glance" : "An empty tree, ready to grow"}</h2>
      </div>
      <div class="stat-row">
        <div class="stat"><b>${people.length}</b><span>People</span></div>
        <div class="stat"><b>${gens}</b><span>${gens === 1 ? "Generation" : "Generations"}</span></div>
        <div class="stat"><b>${years.length ? Math.min(...years) : "–"}</b><span>Earliest</span></div>
      </div>
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
          <ul class="rel-list" style="margin-top:8px">
            ${flagged.map((p) => `<li><span><button class="who" data-goto="${p.id}">${esc(fullName(p))}</button>
              <span class="small muted" style="display:block">${esc(p.issues[0].text)}${p.issues.length > 1 ? ` (+${p.issues.length - 1} more)` : ""}</span></span></li>`).join("")}
          </ul>
        </details>` : ""}
      ${isOwner ? `<p class="small muted">Want help filling it in? <a href="${esc(this.app.CFG.shareUrl)}">Invite family with a link</a>.</p>` : ""}
      ${people.length ? `
        <details>
          <summary>Everyone on this tree (${people.length})</summary>
          <ul class="rel-list" style="margin-top:8px">
            ${sorted.map((p) => `<li><button class="who" data-goto="${p.id}">${esc(fullName(p))}</button><span class="muted small">${esc(lifespan(p))}</span></li>`).join("")}
          </ul>
        </details>
        <p class="small muted">Tip: drag to turn the tree, scroll or pinch to zoom, right-drag to slide.</p>` : ""}`);
    this.on("[data-act=grow]", "click", () => this.app.timelapse.open());
    this.on("[data-act=relate]", "click", () => this.relate());
    this.on("[data-act=add]", "click", () => this.personForm({ mode: "add" }));
    this.on("[data-act=add-self]", "click", () => this.personForm({ mode: "add", self: true }));
    this.on("[data-goto]", "click", (e) => this.app.select(Number(e.currentTarget.dataset.goto), { fly: true }));
  }

  // ------------------------------------------------------------ one person
  person(id) {
    const p = this.store.byId.get(id);
    if (!p) return this.overview();
    this.view = "person";
    const { fam, byId, canEdit, isOwner, me, rels } = this.store;
    const parentCount = (fam.parents.get(id) || []).length;
    const relRow = (otherId, kind, relId) => {
      const o = byId.get(otherId);
      if (!o) return "";
      return `<li><span><span class="kind">${kind}</span><button class="who" data-goto="${o.id}">${esc(fullName(o))}</button></span>
        ${canEdit && relId ? `<button class="linklike danger small" data-unlink="${relId}" title="Remove this link">Unlink</button>` : ""}</li>`;
    };
    const rows = [];
    for (const r of rels) {
      if (r.kind === "parent" && r.person_b === id) rows.push(relRow(r.person_a, "Parent", r.id));
    }
    for (const r of rels) {
      if (r.kind === "spouse" && (r.person_a === id || r.person_b === id)) rows.push(relRow(r.person_a === id ? r.person_b : r.person_a, "Partner", r.id));
    }
    for (const r of rels) {
      if (r.kind === "parent" && r.person_a === id) rows.push(relRow(r.person_b, "Child", r.id));
    }
    const siblings = new Set();
    for (const par of fam.parents.get(id) || []) for (const c of fam.children.get(par) || []) if (c !== id) siblings.add(c);
    for (const s of siblings) rows.push(relRow(s, "Sibling", null));

    const facts = [["Born", p.birth_display], ["Birthplace", p.birth_place], ["Died", p.death_display]]
      .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");
    const photo = p.photo_url
      ? `<img class="portrait" src="${esc(p.photo_url)}" alt="Photo of ${esc(fullName(p))}">`
      : `<div class="portrait initials" aria-hidden="true">${esc(initials(p))}</div>`;
    const focusOn = this.app.focusId === id;

    this.render(`
      <p><button class="linklike" data-act="back">← Overview</button></p>
      <div class="panel-head">
        ${photo}
        <h2>${esc(fullName(p))}</h2>
        ${lifespan(p) ? `<p class="muted">${esc(lifespan(p))}${p.deceased ? " · remembered" : ""}</p>` : ""}
      </div>
      ${this.accountCard(p)}
      ${facts ? `<dl class="facts">${facts}</dl>` : ""}
      ${p.private ? `<p class="small muted">${esc(p.first_name)} is living, so their dates and places are only shown to people who can edit this tree.</p>` : ""}
      ${p.issues?.length ? `
        <section class="issues stack-sm" aria-labelledby="issues-h">
          <h3 id="issues-h">Worth a second look</h3>
          <ul class="issue-list">${p.issues.map(issueItem).join("")}</ul>
          <p class="small muted">Fix a date with <b>Edit details</b>, or leave it if the records really say so. Only people who can edit this tree see these notes.</p>
        </section>` : ""}
      ${p.notes ? `<p>${esc(p.notes).replace(/\n/g, "<br>")}</p>` : ""}
      <section class="stack-sm">
        <h3>Family</h3>
        ${rows.length ? `<ul class="rel-list">${rows.join("")}</ul>` : `<p class="muted small">No relatives linked yet.</p>`}
      </section>
      <section class="stack-sm">
        <h3>Explore</h3>
        <div class="chip-row">
          <button class="btn-sm" data-act="focus" aria-pressed="${focusOn}">${focusOn ? "Show everyone" : "Focus on this branch"}</button>
          ${me.person_id && me.person_id !== id ? `<button class="btn-sm" data-act="relate-me">How are we related?</button>`
            : `<button class="btn-sm" data-act="relate-from">Compare with…</button>`}
        </div>
      </section>
      ${canEdit ? `
        <section class="stack-sm">
          <h3>Add family</h3>
          <div class="chip-row">
            ${parentCount < 2 ? `<button class="btn-sm" data-add="parent">+ Parent</button>` : ""}
            <button class="btn-sm" data-add="spouse">+ Partner</button>
            <button class="btn-sm" data-add="child">+ Child</button>
          </div>
          ${this.store.people.length > 1 ? `
          <details>
            <summary>Link someone already on the tree</summary>
            <div class="stack" style="margin-top:10px">
              <div class="field"><label for="link-kind">${esc(p.first_name)} is the…</label>
                <select id="link-kind"><option value="parent">parent of</option><option value="child">child of</option><option value="spouse">partner of</option></select></div>
              <div class="field"><label for="link-other">Person</label>
                <select id="link-other">${[...this.store.people].filter((o) => o.id !== id).sort((a, b) => fullName(a).localeCompare(fullName(b)))
                  .map((o) => `<option value="${o.id}">${esc(fullName(o))}</option>`).join("")}</select></div>
              <div><button class="btn-sm" data-act="link">Link them</button></div>
            </div>
          </details>` : ""}
        </section>
        <div class="btn-row">
          <button data-act="edit">Edit details</button>
          <button class="btn-ghost danger" data-act="delete" style="color:var(--danger)">Remove</button>
        </div>
        <div class="card flat stack" data-confirm hidden>
          <p>Remove ${esc(fullName(p))} and their links from the tree?</p>
          <div class="btn-row"><button class="btn-danger" data-act="delete-yes">Remove</button><button data-act="delete-no">Keep</button></div>
        </div>` : ""}
      ${isOwner && !p.account ? `<p class="small muted"><a href="${esc(this.app.CFG.shareUrl)}?person=${id}">Invite ${esc(p.first_name)} to claim this leaf</a></p>` : ""}
      <p class="error" role="alert"></p>`);

    this.on("[data-act=back]", "click", () => this.app.deselect());
    this.on("[data-goto]", "click", (e) => this.app.select(Number(e.currentTarget.dataset.goto), { fly: true }));
    this.on("[data-act=focus]", "click", () => this.app.toggleFocus(id));
    this.on("[data-act=relate-me]", "click", () => this.relate(me.person_id, id, true));
    this.on("[data-act=relate-from]", "click", () => this.relate(id, null));
    this.on("[data-add]", "click", (e) => this.personForm({ mode: "add", link: { to: id, as: e.currentTarget.dataset.add } }));
    this.on("[data-act=edit]", "click", () => this.personForm({ mode: "edit", person: p }));
    this.on("[data-act=delete]", "click", () => (this.el.querySelector("[data-confirm]").hidden = false));
    this.on("[data-act=delete-no]", "click", () => (this.el.querySelector("[data-confirm]").hidden = true));
    this.on("[data-act=delete-yes]", "click", this.guard(async () => {
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
      await this.app.api.unlink(Number(e.currentTarget.dataset.unlink));
      await this.app.refresh();
      this.person(id);
    }));
    this.on("[data-act=link]", "click", this.guard(async () => {
      const other = Number(this.el.querySelector("#link-other").value);
      await this.app.api.link(id, other, this.el.querySelector("#link-kind").value);
      await this.app.refresh();
      this.person(id);
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
        <form class="stack" data-connect-form hidden style="flex-basis:100%">
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
    this.view = "form";
    const { byId, me } = this.store;
    const other = link ? byId.get(link.to) : null;
    const v = (k) => esc(person?.[k] ?? "");
    const heading = mode === "edit" ? `Edit ${esc(fullName(person))}`
      : other ? `Add ${link.as === "spouse" ? "a partner" : `a ${link.as}`} for ${esc(other.first_name)}`
      : self ? "Add yourself" : "Add a person";
    const presetLast = other && link.as === "child" ? esc(other.last_name) : "";
    const genders = ["female", "male", "non-binary"];
    this.render(`
      <p><button class="linklike" data-act="back">← Back</button></p>
      <h2>${heading}</h2>
      <form class="stack" data-form>
        <div class="two-col">
          <div class="field"><label for="f-first">First name</label><input id="f-first" name="first_name" required maxlength="100" value="${mode === "edit" ? v("first_name") : ""}" autocomplete="off"></div>
          <div class="field"><label for="f-last">Last name</label><input id="f-last" name="last_name" maxlength="100" value="${mode === "edit" ? v("last_name") : presetLast}" autocomplete="off"></div>
        </div>
        <div class="two-col">
          <div class="field"><label for="f-born">Born</label><input id="f-born" name="birth_date" value="${mode === "edit" ? v("birth_display") : ""}" placeholder="2 Mar 1921" autocomplete="off"></div>
          <div class="field"><label for="f-died">Died</label><input id="f-died" name="death_date" value="${mode === "edit" ? v("death_display") : ""}" placeholder="leave blank if living" autocomplete="off"></div>
        </div>
        <p class="date-hint">Exact dates, just a year, or “about 1921” all work.</p>
        <label class="check"><input type="checkbox" name="deceased" id="f-deceased" ${person?.deceased ? "checked" : ""}> Has passed away</label>
        <div class="field"><label for="f-place">Birthplace</label><input id="f-place" name="birth_place" maxlength="200" value="${mode === "edit" ? v("birth_place") : ""}" placeholder="Brooklyn, New York"></div>
        <div class="field"><label for="f-gender">Gender <span class="hint">helps name relationships (aunt, uncle…)</span></label>
          <input id="f-gender" name="gender" list="gender-options" maxlength="30" value="${mode === "edit" ? v("gender") : ""}">
          <datalist id="gender-options">${genders.map((g) => `<option value="${g}">`).join("")}</datalist></div>
        <div class="field"><label for="f-notes">Notes and stories</label><textarea id="f-notes" name="notes" maxlength="5000" placeholder="Where they lived, what they did, the stories people tell">${mode === "edit" ? v("notes") : ""}</textarea></div>
        <div class="field"><label for="f-photo">Photo</label><input id="f-photo" name="photo" type="file" accept="image/jpeg,image/png,image/gif,image/webp">
          ${mode === "edit" && person.photo_url ? `<label class="check small"><input type="checkbox" id="f-photo-remove"> Remove the current photo</label>` : ""}</div>
        ${mode === "add" && !me.person_id && !link ? `<label class="check"><input type="checkbox" id="f-self" ${self ? "checked" : ""}> This is me</label>` : ""}
        <div class="btn-row"><button class="btn-primary">${mode === "edit" ? "Save changes" : "Add to tree"}</button></div>
        <p class="error" role="alert"></p>
      </form>`);

    const form = this.el.querySelector("[data-form]");
    const died = form.querySelector("#f-died"), deceased = form.querySelector("#f-deceased");
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
        if (link) data.link = link;
        saved = (await this.app.api.addPerson(data)).person;
        if (form.querySelector("#f-self")?.checked) await this.app.api.claim(saved.id);
      }
      const file = form.querySelector("#f-photo").files[0];
      if (file) await this.app.api.uploadPhoto(saved.id, file);
      else if (form.querySelector("#f-photo-remove")?.checked) await this.app.api.removePhoto(saved.id);
      await this.app.refresh({ reframe: mode === "add" && this.store.people.length <= 1 });
      // Adding a second parent? Link the two parents as a couple (the usual
      // case), so they sit together rather than looking like two separate roots.
      if (mode === "add" && link && link.as === "parent" && other) {
        const ps = this.store.fam.parents.get(other.id) || [];
        if (ps.length === 2 && !(this.store.fam.spouses.get(ps[0]) || []).includes(ps[1])) {
          try { await this.app.api.link(ps[0], ps[1], "spouse"); await this.app.refresh(); } catch (e) { /* non-fatal */ }
        }
      }
      // Return to the person you were building around, so you can add the other
      // parent or more children without accidentally chaining generations.
      const focusId = (mode === "add" && link && (link.as === "parent" || link.as === "child")) ? other.id : saved.id;
      this.app.select(focusId, { fly: mode === "add" });
    }));
    form.querySelector("#f-first").focus();
  }

  // ------------------------------------------------------------ how are we related?
  relate(a = null, b = null, auto = false) {
    this.view = "relate";
    const { people, me } = this.store;
    const sorted = [...people].sort((x, y) => fullName(x).localeCompare(fullName(y)));
    const first = a ?? me.person_id ?? this.store.selected ?? sorted[0]?.id;
    const second = b ?? (this.store.selected && this.store.selected !== first ? this.store.selected : sorted.find((p) => p.id !== first)?.id);
    const options = (sel) => sorted.map((p) => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(fullName(p))}${p.account?.is_me ? " (you)" : ""}</option>`).join("");
    this.render(`
      <p><button class="linklike" data-act="back">← Back</button></p>
      <div class="panel-head"><p class="eyebrow">Relationship finder</p><h2>How are we related?</h2></div>
      <p class="muted small">Pick two people. Kinroot names the relationship and lights up the path between them on the tree.</p>
      <form class="stack" data-relate>
        <div class="field"><label for="rel-a">From</label><select id="rel-a">${options(first)}</select></div>
        <div class="field"><label for="rel-b">To</label><select id="rel-b">${options(second)}</select></div>
        <div><button class="btn-primary">Show me</button></div>
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
    if (auto || (a && b)) run();
  }
}

function alertInline(root, message) {
  const p = document.createElement("p");
  p.className = "error";
  p.setAttribute("role", "alert");
  p.textContent = message;
  root.appendChild(p);
}
