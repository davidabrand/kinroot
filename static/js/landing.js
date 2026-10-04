// Kinroot homepage: drives the one persistent tree through the story.
// Plain JS, no libraries. Observers instead of scroll polling; the only scroll
// work (header state, hero fade) is batched into one requestAnimationFrame.
(() => {
  const scene = document.querySelector(".kr-scene:not(.kr-figure)");
  if (!scene) return;
  // Phones show a framed copy of the tree inside the sections that demonstrate something with it.
  const figures = [...document.querySelectorAll(".kr-figure")];
  const drawing = scene.querySelector(".kr-tree");
  for (const fig of figures) if (drawing) fig.appendChild(drawing.cloneNode(true));
  const root = document.documentElement;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const desktop = matchMedia("(min-width: 901px)");

  // ---- 1. Which section are we in? Sets the tree's stage, the section index and the nav.
  const sections = [...document.querySelectorAll("[data-stage][id]")];
  const indexLinks = [...document.querySelectorAll(".kr-index a")];
  const navLinks = [...document.querySelectorAll(".kr-nav a")];
  const indexNav = document.querySelector(".kr-index");
  const INDEX_FOR = { home: "home", explore: "explore", time: "time", relate: "relate", together: "together", privacy: "together", begin: "begin" };

  function setStage(section) {
    const stage = section.dataset.stage;
    if (stage !== "begin") scene.dataset.stage = stage;      // the paper covers the tree; it keeps its last pose
    const fig = section.querySelector(".kr-figure");
    if (fig) fig.dataset.stage = stage;                       // a phone's copy takes its pose as you reach it
    const indexId = INDEX_FOR[section.id];
    indexLinks.forEach((a) => {
      const on = a.dataset.for === indexId;
      a.classList.toggle("is-active", on);
      if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
    navLinks.forEach((a) => a.classList.toggle("is-active", a.dataset.for === section.id));
    indexNav?.classList.toggle("on-paper", stage === "begin");
    if (stage === "time") timeline.start(); else timeline.leave();
  }
  const stageObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => e.isIntersecting && setStage(e.target));
  }, { rootMargin: "-48% 0px -48% 0px" });                   // a thin band across the middle of the screen
  sections.forEach((s) => stageObserver.observe(s));

  // ---- 2. Header backdrop after the first scroll; hero copy drifts up and fades as you leave it.
  const header = document.querySelector(".kr-header");
  const heroCopy = document.querySelector(".kr-hero-copy");
  const paper = document.querySelector(".kr-paper");
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = scrollY;
      header?.setAttribute("data-scrolled", y > 48 ? "true" : "false");
      // Once the paper sheet slides under the header, the header takes on the paper's tone.
      if (header && paper) header.dataset.surface = paper.getBoundingClientRect().top <= header.offsetHeight / 2 ? "paper" : "";
      if (heroCopy && !reduceMotion && desktop.matches) {
        const p = Math.min(1, Math.max(0, y / 500));
        heroCopy.style.transform = p ? `translateY(${-70 * p}px)` : "";
        heroCopy.style.opacity = p ? String(1 - p) : "";
      } else if (heroCopy) {
        heroCopy.style.transform = heroCopy.style.opacity = "";
      }
      ticking = false;
    });
  }
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---- 3. "Watch a century unfold": people appear in the year they were born.
  const nodes = [...document.querySelectorAll(".kr-scene .kt-node")];
  const lines = [...document.querySelectorAll(".kr-scene .kt-line")];
  const playBtn = document.querySelector(".kr-play");
  const yearOut = document.querySelector(".kr-year");
  const rail = document.querySelector(".kr-rail");
  const FIRST = 1895, LAST = 2025, DURATION = 7000;
  const timeline = {
    raf: 0, started: false, from: 0, year: LAST,
    show(year) {
      this.year = year;
      const y = Math.floor(year);
      nodes.forEach((n) => {
        const died = Number(n.dataset.died) || 0;
        n.classList.toggle("is-future", Number(n.dataset.born) > y);
        n.classList.toggle("is-remembered", died > 0 && died <= y);
      });
      lines.forEach((l) => l.classList.toggle("is-future", Number(l.dataset.born) > y));
      if (yearOut) yearOut.textContent = String(Math.min(y, LAST));
      rail?.style.setProperty("--progress", `${((year - FIRST) / (LAST - FIRST)) * 100}%`);
    },
    play() {
      cancelAnimationFrame(this.raf);
      playBtn?.setAttribute("aria-pressed", "true");
      playBtn?.setAttribute("aria-label", "Pause the timeline");
      if (reduceMotion) { this.show(LAST); return this.stop(); }
      if (this.year >= LAST) this.year = FIRST;
      this.from = performance.now() - ((this.year - FIRST) / (LAST - FIRST)) * DURATION;
      const step = (now) => {
        const t = Math.min(1, (now - this.from) / DURATION);
        this.show(FIRST + t * (LAST - FIRST));
        if (t < 1) this.raf = requestAnimationFrame(step); else this.stop();
      };
      this.raf = requestAnimationFrame(step);
    },
    stop() {
      cancelAnimationFrame(this.raf);
      playBtn?.setAttribute("aria-pressed", "false");
      playBtn?.setAttribute("aria-label", "Play the timeline");
    },
    start() {                                       // entering the section plays it once, from the beginning
      if (this.started) return;
      this.started = true;
      this.year = FIRST;
      this.play();
    },
    leave() {                                       // leaving resets, so the next visit plays again
      if (!this.started) return;
      this.stop();
      this.started = false;
      nodes.forEach((n) => n.classList.remove("is-future", "is-remembered"));
      lines.forEach((l) => l.classList.remove("is-future"));
      this.year = LAST;
      if (yearOut) yearOut.textContent = String(LAST);
      rail?.style.setProperty("--progress", "100%");
    },
  };
  playBtn?.addEventListener("click", () => {
    if (playBtn.getAttribute("aria-pressed") === "true") timeline.stop(); else timeline.play();
  });

  // ---- 3b. On phones the tree is a framed picture, so crop the drawing tightly around it.
  const svgs = [...document.querySelectorAll(".kr-scene .kt")];
  const WIDE = svgs[0]?.getAttribute("viewBox");
  const frame = () => svgs.forEach((svg) => svg.setAttribute("viewBox", desktop.matches ? WIDE : "240 90 900 920"));
  desktop.addEventListener?.("change", frame);
  frame();

  // ---- 4. Pointer depth: the tree shifts a few pixels, the light a little less. Text never moves.
  if (!reduceMotion && matchMedia("(pointer: fine)").matches) {
    let px = 0, py = 0, queued = false;
    addEventListener("pointermove", (e) => {
      px = (e.clientX / innerWidth) * 2 - 1;
      py = (e.clientY / innerHeight) * 2 - 1;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        scene.style.setProperty("--px", px.toFixed(3));
        scene.style.setProperty("--py", py.toFixed(3));
        queued = false;
      });
    }, { passive: true });
  }

  // ---- 5. Film grain: one small noise tile, made once (felt, not seen).
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 120;
    const g = c.getContext("2d");
    const img = g.createImageData(120, 120);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 110 + Math.random() * 145;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    scene.style.setProperty("--grain", `url(${c.toDataURL("image/png")})`);
  } catch { /* no grain is fine */ }

  // ---- 6. Reveals where scroll-driven animations aren't supported.
  if (!(window.CSS && CSS.supports("animation-timeline: view()")) && !reduceMotion) {
    root.classList.add("no-sda");
    const revealer = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("in"); revealer.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -12% 0px" });
    document.querySelectorAll(".rv, .rv2, .rv3").forEach((el) => revealer.observe(el));
  }
})();
