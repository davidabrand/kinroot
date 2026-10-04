// "Find someone" box in the tree toolbar.
import { fullName, lifespan } from "./util.js";

const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export class Search {
  constructor(input, list, onChoose) {
    this.input = input;
    this.list = list;
    this.onChoose = onChoose;
    this.people = [];
    this.active = 0;
    this.results = [];
    input.addEventListener("input", () => this.show());
    input.addEventListener("focus", () => input.value && this.show());
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); this.move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); this.move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); this.choose(this.results[this.active]); }
      else if (e.key === "Escape") { this.hide(); input.blur(); }
    });
    // "/" jumps to the search box from anywhere on the page (unless you're already typing).
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !e.target.closest?.("input, textarea, select, [contenteditable]")) { e.preventDefault(); input.focus(); }
    });
    document.addEventListener("pointerdown", (e) => {
      if (!list.contains(e.target) && e.target !== input) this.hide();
    });
  }

  update(people) {
    this.people = people.map((p) => ({ p, key: fold(fullName(p)) }));
  }

  show() {
    const q = fold(this.input.value.trim());
    if (!q) return this.hide();
    const words = q.split(/\s+/);
    this.results = this.people.filter(({ key }) => words.every((w) => key.includes(w))).slice(0, 8).map(({ p }) => p);
    this.active = 0;
    this.list.innerHTML = "";
    if (!this.results.length) {
      const li = document.createElement("li");
      li.className = "sr-empty";
      li.textContent = "Nobody by that name yet.";
      this.list.appendChild(li);
    }
    // Each result: their portrait (or initials), name and years.
    this.results.forEach((p, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      const face = document.createElement("span");
      face.className = "sr-face";
      face.setAttribute("aria-hidden", "true");
      if (p.photo_url) {
        const img = document.createElement("img");
        img.alt = "";
        img.src = p.photo_url;
        face.appendChild(img);
      } else {
        face.textContent = ((p.first_name || "?")[0] + (p.last_name ? p.last_name[0] : "")).toUpperCase();
      }
      const name = document.createElement("span");
      name.className = "sr-name";
      name.textContent = fullName(p);
      const small = document.createElement("small");
      small.textContent = lifespan(p);
      b.append(face, name, small);
      b.addEventListener("click", () => this.choose(p));
      if (i === 0) b.classList.add("active");
      li.appendChild(b);
      this.list.appendChild(li);
    });
    this.list.hidden = false;
  }

  move(step) {
    if (!this.results.length) return;
    this.active = (this.active + step + this.results.length) % this.results.length;
    this.list.querySelectorAll("button").forEach((b, i) => b.classList.toggle("active", i === this.active));
  }

  choose(p) {
    if (!p) return;
    this.hide();
    this.input.value = "";
    this.input.blur();
    this.onChoose(p.id);
  }

  hide() {
    this.list.hidden = true;
  }
}
