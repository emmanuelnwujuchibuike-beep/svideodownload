/**
 * Return to the SAME POST, not the same pixel (owner, 2026-10-15: "when am in feed page
 * watch something and goes to a different page and come back it starts to lag and come
 * down to where I was slowly and lagging badly and also doesn't get it accurately").
 *
 * A saved `scrollY` is only right if every card above lays out at the height it had when
 * the reader left. On a return they don't: photos, videos and ad boxes size themselves a
 * moment later, so the old number points at a different post. The old restore therefore
 * retried `scrollTo` on every frame for a second as the page grew, which you could watch
 * crawl down.
 *
 * Now the reader's place is the post at the top of the screen plus how far into it they
 * were (`readAnchor`). The return lands on that post once (`restoreToAnchor`). It then
 * corrects only when the page actually changes size (a ResizeObserver, not a frame loop),
 * so media loading above keeps the post exactly where it was. The reader's first touch,
 * wheel or key ends it.
 *
 * Browser-only, no React; `[data-feed-post]` is the attribute the feed's cards carry.
 */

export interface ScrollAnchor {
  /** the id on the card's anchor attribute */
  id: string;
  /** the card's top relative to the viewport when saved (negative = scrolled into it) */
  offset: number;
}

/** The first card still visible below `probeY` (px from the viewport top), or null. */
/**
 * The reader's place, but only once they are IN a post (owner, 2026-10-31: "going back to for you from following …
 * take the feed page down even if I didn't scroll"). At the top of the Feed the first card crossing the probe is
 * still BELOW it — under the stories and Continue Watching — and the return held that card at its saved height for
 * two seconds while the pictures above it loaded, scrolling the page down to keep it there. A card whose top is
 * below the probe is not where anyone is reading: no anchor, so the return lands on the exact saved scroll (the top).
 */
export function readReaderAnchor(attr: string, probeY: number, root: ParentNode = document): ScrollAnchor | null {
  const a = readAnchor(attr, probeY, root);
  return a && a.offset <= probeY ? a : null;
}

export function readAnchor(attr: string, probeY: number, root: ParentNode = document): ScrollAnchor | null {
  for (const el of root.querySelectorAll<HTMLElement>(`[${attr}]`)) {
    const r = el.getBoundingClientRect();
    if (r.bottom > probeY) {
      const id = el.getAttribute(attr);
      return id ? { id, offset: Math.round(r.top) } : null;
    }
  }
  return null;
}

// Landing on the anchor (anchorTarget, restoreToAnchor) is in ./scroll-anchor-restore.ts, loaded only
// when a return actually restores: the feed page ships just the read above.
