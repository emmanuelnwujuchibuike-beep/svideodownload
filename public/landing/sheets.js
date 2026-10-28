// Frenz landing — the three sheets (platforms, menu, what's new), imported on the first tap that opens one.
// Native <dialog>: Esc closes it (the browser), so do a tap on the backdrop and the ✕; focus goes back to the button.
const wired = new Set();

export function open(id, trigger) {
  const d = document.getElementById(id);
  if (!d || d.open) return;
  if (!wired.has(id)) {
    wired.add(id);
    d.addEventListener("click", (e) => {
      if (e.target === d || e.target.closest("[data-close]")) d.close();
    });
  }
  d.showModal();
  if (trigger) {
    trigger.setAttribute("aria-expanded", "true");
    if (id === "newsSheet") trigger.querySelector(".dot")?.remove();
  }
  d.addEventListener(
    "close",
    () => {
      if (!trigger) return;
      trigger.setAttribute("aria-expanded", "false");
      trigger.focus();
    },
    { once: true },
  );
}
