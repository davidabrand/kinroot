// "Watch your family grow": a century of the family in about twenty seconds.
// Each person appears in the year they were born, a line extends to them from their parents,
// and a fine second ring appears around someone in the year they pass away.
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
    // Playback speed: 1x, 2x, 4x. Takes effect immediately, even mid-play.
    this.speed = 1;
    this.speedBtn = root.querySelector("#tl-speed");
    this.speedBtn?.addEventListener("click", () => {
      this.speed = this.speed === 4 ? 1 : this.speed * 2;
      this.speedBtn.textContent = `${this.speed}×`;
      this.speedBtn.setAttribute("aria-label", `Playback speed: ${this.speed} times`);
    });
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
    this.recent = [];
    this._shownYear = null;
    this.year = this.start;
    this.app.scene.setYear(this.start, this.years, false);
    this.app.scene.frameAll(true, { lift: 0.14 });   // the whole family's space, clear of the playback bar
    this.showYear();
    this.play();
  }

  play() {
    if (this.year >= this.end) {
      this.year = this.start;
      this.recent = [];
      this.eventsEl.innerHTML = "";
      this.app.scene.setYear(this.start, this.years, false);
    }
    this.playing = true;
    this.playBtn.setAttribute("aria-label", "Pause");
    this.playBtn.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 5h2.4v10H6.5zM11.1 5h2.4v10h-2.4z" fill="currentColor"/></svg>`;
    this.app.scene.setAutoRotate(true);
    const span = this.end - this.start;
    const duration = Math.min(16000, Math.max(7000, span * 100));   // about a century in ten seconds at 1x
    let last = performance.now();
    const tick = (now) => {
      if (!this.playing) return;
      const before = this.year;
      this.year = Math.min(this.end, this.year + ((now - last) * this.speed / duration) * span);
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
    this.playBtn.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5l8 5-8 5z" fill="currentColor"/></svg>`;
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
    if (y !== this._shownYear) {
      this._shownYear = y;
      const born = [...this.years.born.values()].filter((b) => b <= y).length;
      this.app.panel.growUpdate?.({ year: y, born, total: this.app.store.people.length, recent: this.recent || [] });
    }
  }

  announce(from, to) {
    for (const e of this.events) if (e.year > Math.floor(from) && e.year <= Math.floor(to)) this.announceText(e.text, e.year);
  }

  announceText(text, year) {
    this.recent = [...(this.recent || []), { text, year }].slice(-6);
    this._shownYear = null;                  // let the panel pick up the new line
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
