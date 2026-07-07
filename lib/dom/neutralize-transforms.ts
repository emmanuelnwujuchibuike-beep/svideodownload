/**
 * CSS containing-block guard for in-place fullscreen promotions (FeedVideo,
 * MediaCarousel — anything that turns a card's own box into a fixed,
 * edge-to-edge layer via `position: fixed` rather than a portal, to keep a
 * `<video>` element's identity/playback state intact).
 *
 * The trap: ANY ancestor with an inline `transform` (even `translateY(0px)`,
 * which framer-motion leaves behind after an entrance animation settles)
 * becomes the containing block for `position: fixed` descendants — silently
 * anchoring them to that ancestor's box instead of the true viewport. This
 * walks up from `el` and neutralizes any such transform for as long as
 * fullscreen is active, returning a function that restores every value
 * exactly as it was on exit.
 */
export function neutralizeAncestorTransforms(el: HTMLElement | null): () => void {
  if (!el || typeof document === "undefined") return () => {};
  const touched: { node: HTMLElement; prev: string }[] = [];
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const inline = node.style.transform;
    if (inline && inline !== "none") {
      touched.push({ node, prev: inline });
      node.style.transform = "none";
    }
    node = node.parentElement;
  }
  return () => {
    for (const { node, prev } of touched) node.style.transform = prev;
  };
}
