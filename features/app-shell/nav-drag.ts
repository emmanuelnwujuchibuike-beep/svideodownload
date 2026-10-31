/**
 * Press & drag on the bottom nav's glass (owner, 2026-10-31 — the "Frenz · Glass Bottom Nav" reference): pressing
 * lifts and magnifies the lens; dragging along the bar moves the lens with the finger and releasing opens the tab it
 * lands on.
 *
 * 🔴 FAST NAVIGATION IS NOT TOUCHED. A plain tap never reaches this code's navigation: it stays the tab's own <Link>
 * (prefetch, haptic, pending stripe). Only a press that MOVES 6 px becomes a drag, and a drag opens its tab by
 * clicking that tab's real link — the same path as a tap. Pointer capture starts only once it is a drag, so a tap's
 * click still lands on its link.
 *
 * 🔴 NOT ON A COLD ENTRY. mobile-nav.tsx imports this lazily when the browser is idle after load; the lens itself
 * (and its slide between tabs) is pure CSS (globals.css .frenz-nav-lens). Until this loads, taps work exactly the same.
 */
const SLOP = 6;
/** The pill's padding (p-1.5) — the lens's travel starts and ends inside it. */
const PAD = 6;

export function attachNavDrag(nav: HTMLElement): () => void {
  let down = false;
  let moved = false;
  let startX = 0;
  let pointer = -1;
  let swallowUntil = 0;

  const tabs = () => Array.from(nav.querySelectorAll<HTMLAnchorElement>(":scope > a"));
  const lensWidth = () => nav.querySelector<HTMLElement>(".frenz-nav-lens")?.offsetWidth || nav.clientWidth / 4;
  const nearest = (clientX: number): HTMLAnchorElement | null => {
    const r = nav.getBoundingClientRect();
    let best: HTMLAnchorElement | null = null;
    let d = Number.POSITIVE_INFINITY;
    for (const t of tabs()) {
      const c = Math.abs(t.offsetLeft + t.offsetWidth / 2 - (clientX - r.left));
      if (c < d) {
        d = c;
        best = t;
      }
    }
    return best;
  };
  const reset = () => {
    down = false;
    moved = false;
    nav.classList.remove("frenz-nav-pressing", "frenz-nav-dragging");
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    down = true;
    moved = false;
    startX = e.clientX;
    pointer = e.pointerId;
    nav.classList.add("frenz-nav-pressing");
  };
  const onMove = (e: PointerEvent) => {
    if (!down || e.pointerId !== pointer) return;
    if (!moved) {
      if (Math.abs(e.clientX - startX) < SLOP) return;
      moved = true;
      try {
        nav.setPointerCapture(pointer);
      } catch {
        /* the pointer is already gone — the up/cancel below resets */
      }
      nav.classList.add("frenz-nav-dragging");
    }
    const r = nav.getBoundingClientRect();
    const w = lensWidth();
    const x = Math.min(Math.max(e.clientX - r.left - PAD - w / 2, 0), r.width - PAD * 2 - w);
    nav.style.setProperty("--x", `${x}px`);
  };
  const onUp = (e: PointerEvent) => {
    if (!down || e.pointerId !== pointer) return;
    const dragged = moved;
    reset();
    if (!dragged) return; // a tap: its own link handles it
    const target = nearest(e.clientX);
    swallowUntil = performance.now() + 400; // the browser's own click after a drag must not navigate a second time
    target?.click();
  };
  const onCancel = (e: PointerEvent) => {
    if (e.pointerId === pointer) reset();
  };
  const onClick = (e: MouseEvent) => {
    if (e.isTrusted && performance.now() < swallowUntil) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  nav.addEventListener("pointerdown", onDown);
  nav.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  nav.addEventListener("click", onClick, true);
  return () => {
    nav.removeEventListener("pointerdown", onDown);
    nav.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    nav.removeEventListener("click", onClick, true);
    reset();
  };
}
