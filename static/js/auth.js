// Sign-in pages (log in and sign up). Everything here is polish: the forms work without it.
(() => {
  const html = document.documentElement;
  const scene = document.querySelector(".auth-scene");
  const motionOK = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Count the years up while the tree grows (a small taste of the time-lapse). Skipped when you
  // hop here from the other sign-in page: the tree is already grown then (partials/auth_head.html).
  const year = document.getElementById("grow-year");
  const tree = document.querySelector(".scene-tree");
  if (year && tree && motionOK && !html.classList.contains("auth-continue")) {
    const start = 1890;
    const end = new Date().getFullYear();
    const duration = 3150;          // until the last medallion blooms (see grow_tree.svg)
    const begin = performance.now() + 250;
    tree.classList.add("js-grow");
    year.textContent = start;
    const tick = (now) => {
      const k = Math.min(1, Math.max(0, (now - begin) / duration));
      year.textContent = Math.round(start + (end - start) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(tick);
      else tree.classList.add("grown");
    };
    requestAnimationFrame(tick);
  }

  // Put the cursor in the first empty box (the password, after a typo). Only with a mouse or
  // trackpad: on a phone, a keyboard popping up straight away would cover the whole scene.
  // Waits for "load" because jumping to #sign-in moves focus to the card once the page is parsed.
  if (window.matchMedia("(pointer: fine)").matches) {
    const focusFirstEmpty = () => requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;  // already typing
      const inputs = [...document.querySelectorAll(".auth-card input:not([type=hidden])")];
      inputs.find((input) => !input.value)?.focus({ preventScroll: true });
    });
    if (document.readyState === "complete") focusFirstEmpty();
    else window.addEventListener("load", focusFirstEmpty, { once: true });
  }

  // While the next page loads, say what's happening and ignore a second click.
  document.querySelectorAll(".auth-card form").forEach((form) => {
    const button = form.querySelector("button[data-busy]");
    if (!button) return;
    const label = button.textContent;
    form.addEventListener("submit", (e) => {
      if (form.dataset.sent) return e.preventDefault();
      form.dataset.sent = "1";
      button.textContent = button.dataset.busy;
      button.setAttribute("aria-busy", "true");
    });
    // The Back button can bring this page back exactly as it was left: make the button usable again.
    window.addEventListener("pageshow", (e) => {
      if (!e.persisted) return;
      delete form.dataset.sent;
      button.textContent = label;
      button.removeAttribute("aria-busy");
    });
  });

  // Gentle parallax: nearer layers drift a little further as the pointer moves. The position is
  // remembered so hopping to the other sign-in page doesn't jolt the scene back to the middle.
  if (!scene || !motionOK || window.matchMedia("(pointer: coarse)").matches) return;
  let frame = 0;
  scene.addEventListener("pointermove", (e) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const r = scene.getBoundingClientRect();
      const px = (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3);
      const py = (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3);
      scene.style.setProperty("--px", px);
      scene.style.setProperty("--py", py);
      try { sessionStorage.setItem("kinroot-parallax", `${px},${py}`); } catch { /* private mode */ }
    });
  });
})();
