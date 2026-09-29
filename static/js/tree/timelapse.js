// "Watch your family grow": a century of the family in about twenty seconds.
// Each person appears in the year they were born, branches grow toward them,
// and leaves turn gold in the year someone passes away.
import { estimateYears } from "./layout.js";
import { fullName } from "./util.js";

export class Timelapse {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.slider = root.querySelector("#tl-slider");
    this.yearEl = root.querySelector("#tl-year");
    this.playBtn = root.querySelector("#tl-play");
    this.eventsEl = root.querySelector("#tl-events");
    this.playing = false;
    this.slider.addEventListener("input", () => {
      this.pause();
      this.setYear(Number(this.slider.value), true);
    });
    this.playBtn.addEventListener("click", () => (this.playing ? this.pause() : this.play()));
    root.querySelector("#tl-close").addEventListener("click", () => this.close());
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open() {
    const { people, fam } = this.app.store;
    if (!people.length || !this.app.scene) return;
    this.app.clearPath();
    this.years = estimateYears(people, fam);
    const thisYear = new Date().getFullYear();
    this.start = Math.min(...this.years.born.values()) - 6;   // time for the trunk to grow first
    this.end = thisYear;
    this.events = [];
    for (const p of people) {
      if (p.birth_year && !this.years.estimated.has(p.id)) this.events.push({ year: p.birth_year, text: `${fullName(p)} is born` });
      if (p.death_year) this.events.push({ year: p.death_year, text: `${fullName(p)} passes away` });
    }
    this.events.sort((a, b) => a.year - b.year);
    this.slider.min = this.start;
    this.slider.max = this.end;
    this.slider.step = 1;
    this.root.hidden = false;
    this.app.onTimelapse?.(true);
    this.eventsEl.innerHTML = "";
    this.year = this.start;
    this.app.scene.setYear(this.start, this.years, false);
    this.app.scene.frameAll();
    this.showYear();
    this.play();
  }

  play() {
    if (this.year >= this.end) {
      this.year = this.start;
      this.eventsEl.innerHTML = "";
      this.app.scene.setYear(this.start, this.years, false);
    }
    this.playing = true;
    this.playBtn.setAttribute("aria-label", "Pause");
    this.playBtn.textContent = "❚❚";
    this.app.scene.setAutoRotate(true);
    const span = this.end - this.start;
    const duration = Math.min(26000, Math.max(9000, span * 150));
    let last = performance.now();
    const tick = (now) => {
      if (!this.playing) return;
      const before = this.year;
      this.year = Math.min(this.end, this.year + ((now - last) / duration) * span);
      last = now;
      this.app.scene.setYear(this.year, this.years, true);
      this.announce(before, this.year);
      this.showYear();
      if (this.year >= this.end) return this.finish();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  pause() {
    this.playing = false;
    this.playBtn.setAttribute("aria-label", "Play");
    this.playBtn.textContent = "▶";
    this.app.scene?.setAutoRotate(false);
  }

  finish() {
    this.pause();
    this.announceText(`Today: ${this.app.store.people.length} people across ${this.app.store.layout.maxGen + 1} generations`);
  }

  setYear(year) {
    const before = this.year;
    this.year = year;
    this.app.scene.setYear(year, this.years, true);
    if (year > before) this.announce(before, year);
    this.showYear();
  }

  showYear() {
    const y = Math.floor(this.year);
    this.yearEl.textContent = y;
    this.slider.value = y;
  }

  announce(from, to) {
    for (const e of this.events) if (e.year > Math.floor(from) && e.year <= Math.floor(to)) this.announceText(e.text, e.year);
  }

  announceText(text, year) {
    const li = document.createElement("li");
    if (year) {
      const b = document.createElement("b");
      b.textContent = year + " ";
      li.appendChild(b);
    }
    li.appendChild(document.createTextNode(text));
    this.eventsEl.appendChild(li);
    while (this.eventsEl.children.length > 3) this.eventsEl.firstElementChild.remove();
  }

  close() {
    if (!this.isOpen) return;
    this.pause();
    this.root.hidden = true;
    this.app.scene?.endTimeline();
    this.app.onTimelapse?.(false);
  }
}
