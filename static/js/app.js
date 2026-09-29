// Small helpers used on ordinary pages.

// "Copy" buttons next to invite links.
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
    setTimeout(() => (button.textContent = old), 1600);
  });
});
