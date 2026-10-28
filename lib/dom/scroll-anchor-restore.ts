import type { ScrollAnchor } from "./scroll-anchor";

/**
 * The landing half of ./scroll-anchor.ts, in its own chunk: the feed loads it only when a
 * return restores the reader's place (and warms it on the first scroll), so the /home
 * route itself ships only `readAnchor`.
 */

/** Where to scroll so the anchored card sits at its saved offset; null when it isn't on the page. */
export function anchorTarget(anchor: ScrollAnchor, attr: string, scrollY: number, root: ParentNode = document): number | null {
  const id = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(anchor.id) : anchor.id.replace(/["\\]/g, "\\$&");
  const el = root.querySelector<HTMLElement>(`[${attr}="${id}"]`);
  if (!el) return null;
  return Math.max(0, Math.round(el.getBoundingClientRect().top + scrollY - anchor.offset));
}

/**
 * Land on the anchored card (else on `fallbackY`) and keep it there while the page settles,
 * for at most `holdMs`. Returns a function that stops it early.
 */
export function restoreToAnchor(opts: {
  anchor: ScrollAnchor | null;
  fallbackY: number;
  attr: string;
  /** where to look for the card (the feed shows two tabs at once during a switch) */
  scope?: () => ParentNode;
  holdMs?: number;
  onLanded?: (y: number) => void;
}): () => void {
  const { anchor, fallbackY, attr, scope, holdMs = 2000, onLanded } = opts;
  let stopped = false;
  let ro: ResizeObserver | null = null;
  let timer = 0;
  const target = () => (anchor ? anchorTarget(anchor, attr, window.scrollY, scope?.() ?? document) : null) ?? fallbackY;
  const land = () => {
    if (stopped) return;
    const y = target();
    /*
      🔴 "instant", never "auto" (owner, 2026-10-28: "the feed page scrolls to get to the post … scrolling to the media
      can cause overheating or lagging"). `auto` means "whatever the CSS says", and globals.css gives `html`
      `scroll-behavior: smooth` — so the return GLIDED down the whole feed, laying out and loading every photo and video
      on the way. `instant` jumps: only the cards around the reader's post are ever on screen to load.
    */
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo({ top: y, behavior: "instant" });
    onLanded?.(window.scrollY);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    ro?.disconnect();
    window.clearTimeout(timer);
    window.removeEventListener("touchstart", stop);
    window.removeEventListener("wheel", stop);
    window.removeEventListener("keydown", stop);
  };
  window.addEventListener("touchstart", stop, { passive: true });
  window.addEventListener("wheel", stop, { passive: true });
  window.addEventListener("keydown", stop);
  land();
  // only when something actually changes size: a card's media arriving, an ad box filling
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => land());
    ro.observe(document.body);
  }
  timer = window.setTimeout(stop, holdMs);
  return stop;
}
