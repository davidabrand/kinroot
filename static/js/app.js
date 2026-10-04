// Small helpers for ordinary (non-auth) pages. Everything here is progressive
// enhancement: every page still works correctly with JavaScript turned off.
//   1. "Copy" buttons next to invite links
//   2. Double-submit protection on forms (double-click / impatient tap / slow network)
//   3. A typed-confirmation guard on "Delete this tree"

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

// ---- 2. Stop a form being submitted twice ----------------------------------
// We flag the form rather than disabling the button, so a button's own
// name/value (e.g. Accept vs Decline) is still included in the submission.
// Auth pages run their own guard (auth.js); role dropdowns submit on change and
// must stay re-selectable, so both are left alone.
document.querySelectorAll('form[method="post"]').forEach((form) => {
  if (form.closest(".auth-card")) return;             // handled by auth.js
  if (form.classList.contains("chat-form")) return;   // handled by chat.js (fetch)
  if (form.querySelector("select[onchange]")) return; // re-selectable dropdown form

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
