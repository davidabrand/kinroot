// Small helpers for ordinary (non-auth) pages. Everything here is progressive
// enhancement: every page still works correctly with JavaScript turned off.
//   1. "Copy" buttons next to invite links
//   2. Double-submit protection on forms (double-click / impatient tap / slow network)
//   3. A typed-confirmation guard on "Delete this tree"

// ---- 0. The app shell's sidebar ---------------------------------------------
// Desktop: collapse to icons (remembered on this device). Phones/tablets: a drawer.
(() => {
  const app = document.getElementById("app");
  if (!app) return;
  const collapse = app.querySelector("[data-sidebar-collapse]");
  const openBtn = app.querySelector("[data-sidebar-open]");
  const scrim = app.querySelector("[data-sidebar-close]");
  const setCollapsed = (on) => {
    app.classList.toggle("sb-collapsed", on);
    collapse?.setAttribute("aria-expanded", String(!on));
    collapse?.setAttribute("title", on ? "Expand the sidebar" : "Collapse the sidebar");
  };
  try { setCollapsed(localStorage.getItem("kinroot-sidebar") === "collapsed"); } catch { /* storage blocked */ }
  collapse?.addEventListener("click", () => {
    const on = !app.classList.contains("sb-collapsed");
    setCollapsed(on);
    try { localStorage.setItem("kinroot-sidebar", on ? "collapsed" : "open"); } catch { /* storage blocked */ }
  });
  const setOpen = (on) => {
    app.classList.toggle("nav-open", on);
    openBtn?.setAttribute("aria-expanded", String(on));
    if (scrim) scrim.hidden = !on;
    if (on) app.querySelector(".sb-nav a")?.focus();
  };
  openBtn?.addEventListener("click", () => setOpen(true));
  scrim?.addEventListener("click", () => setOpen(false));
  addEventListener("keydown", (e) => { if (e.key === "Escape" && app.classList.contains("nav-open")) { setOpen(false); openBtn?.focus(); } });
  app.querySelectorAll(".sb-nav a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
})();

// ---- People page: instant search -------------------------------------------
(() => {
  const input = document.querySelector("[data-people-search]");
  const list = document.querySelector("[data-people-list]");
  if (!input || !list) return;
  const none = document.querySelector("[data-people-none]");
  const rows = [...list.querySelectorAll("[data-search]")];
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    rows.forEach((r) => { const on = !q || r.dataset.search.includes(q); r.hidden = !on; shown += on; });
    if (none) none.hidden = shown > 0;
  });
})();

// ---- 1. Copy buttons -------------------------------------------------------
document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const input = document.getElementById(button.dataset.copy);
    if (!input) return;
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand?.("copy");
    }
    const old = button.textContent;
    button.textContent = "Copied";
    button.disabled = true;
    setTimeout(() => {
      button.textContent = old;
      button.disabled = false;
    }, 1600);
  });
});

// Success messages step aside once read; errors stay until they're dealt with.
// (Not while the pointer rests on one, so nobody loses a message mid-read.)
document.querySelectorAll(".flash:not(.error)").forEach((el) => {
  const leave = () => {
    if (el.matches(":hover")) return setTimeout(leave, 2000);
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 300);
  };
  setTimeout(leave, 8000);
});

// Just made an invite link? The page opens on it (#invite-row-N, highlighted by CSS):
// put the Copy button in focus, so Enter copies it.
(() => {
  // (A ternary, not `&&`: `false?.querySelector` would throw and stop the rest of this file.)
  const row = location.hash.startsWith("#invite-row-") ? document.querySelector(location.hash) : null;
  row?.querySelector("[data-copy]")?.focus({ preventScroll: true });
})();

// Arrived from the homepage's "Import a GEDCOM" (/trees#import)? Open the import option.
(() => {
  const openImport = () => {
    const target = document.getElementById("import");
    if (target && target.tagName === "DETAILS") {
      target.open = true;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.querySelector("input[type=file]")?.focus({ preventScroll: true });
    }
  };
  if (location.hash === "#import") openImport();
  document.querySelectorAll("[data-open-import]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openImport(); }));
})();

// ---- 2. Stop a form being submitted twice ----------------------------------
// We flag the form rather than disabling the button, so a button's own
// name/value (e.g. Accept vs Decline) is still included in the submission.
// Auth pages run their own guard (auth.js); role dropdowns submit on change and
// must stay re-selectable, so both are left alone.
document.querySelectorAll('form[method="post"]').forEach((form) => {
  if (form.closest(".auth-card")) return;             // handled by auth.js
  if (form.classList.contains("chat-form")) return;   // handled by chat.js (fetch)
  if (form.querySelector("[onchange]")) return;       // save-on-change forms (role dropdowns, privacy boxes)

  form.addEventListener("submit", (e) => {
    if (form.dataset.sent) {
      e.preventDefault();
      return;
    }
    form.dataset.sent = "1";
    const btn = e.submitter || form.querySelector('button:not([type="button"])');
    if (btn) btn.setAttribute("aria-busy", "true");
  });

  // Returning to a cached page (browser Back): let the form work again.
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    delete form.dataset.sent;
    form.querySelectorAll('[aria-busy="true"]').forEach((b) => b.removeAttribute("aria-busy"));
  });
});

// ---- 3. "Delete this tree" guard -------------------------------------------
// Keep the delete button inactive until the typed name matches the tree's name,
// so a stray click can't delete a tree. The server checks this too; this is
// just a friendlier front stop.
(() => {
  const confirmInput = document.getElementById("confirm");
  if (!confirmInput) return;
  const form = confirmInput.closest("form");
  const button = form?.querySelector(".btn-danger");
  const target = (confirmInput.getAttribute("placeholder") || "").trim();
  if (!form || !button || !target) return;

  const sync = () => {
    const match = confirmInput.value.trim() === target;
    button.disabled = !match;
  };
  sync();
  confirmInput.addEventListener("input", sync);
})();
