"use client";

/**
 * Notices when the visitor SKIPS a Monetag In-Page Push — passively.
 *
 * Owner, 2026-09-03: "make the monetag in page push have a cooldown of 60 secs
 * when is skipped", with the guardrail "it must not block monetag data from
 * reading accurately and showing impression, clicks and revenue."
 *
 * ── This module never touches the ad ──────────────────────────────────────────
 *
 * 🔴 It only OBSERVES. It never removes a node, never hides one, never rewrites a
 * style, never wraps or intercepts a request. A creative that has been served
 * stays exactly as Monetag rendered it and reports exactly what it would have
 * reported — because the alternative, suppressing a creative after the network
 * has already counted it, would corrupt precisely the impression / click /
 * revenue numbers the owner asked to protect. The cooldown that this feeds acts
 * on our own script injection and on nothing else.
 *
 * ── Attribution is by TIME, not by selector ───────────────────────────────────
 *
 * `scripts/monetag-inpage-push-watch.mjs` ran against production for 100 seconds
 * and the tag (nap5k.com/tag.min.js, zone 11441036) returned 200 but served no
 * fill, so the widget's markup could not be read. Guessing a class name for it is
 * how you silently blank half a creative — the lesson from
 * `scripts/hilltop-close-button-probe.mjs`, the same week.
 *
 * So nothing here knows what the widget looks like. A candidate is simply any
 * top-level element that appeared AFTER we injected the tag; the network's DOM is
 * separated from our React tree by WHEN it arrived, not by what it is called.
 * That holds whatever Monetag decides to render, today or after a change on their
 * side.
 *
 * ── What counts as a skip ─────────────────────────────────────────────────────
 *
 * A candidate that was actually SHOWN (it reached at least MIN_W × MIN_H, so a
 * 1×1 tracking pixel or Monetag's own 1×1 `#adex` container can never qualify)
 * and then either leaves the DOM or collapses to nothing. That is the shape of a
 * dismissal regardless of markup.
 *
 * ── The known limit, stated rather than papered over ──────────────────────────
 *
 * A widget hidden with `visibility` or `opacity` rather than removed or
 * collapsed is not detected, and neither is a close button inside a cross-origin
 * iframe that leaves the frame in place. In both cases the cooldown simply does
 * not start and behaviour is exactly what it is today — the failure is inert, not
 * a broken ad. This could not be verified end to end because the tag served no
 * fill during the probe.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────────
 *
 * One `MutationObserver` on `<html>` and `<body>` with `childList` and NO
 * subtree — it wakes only when a top-level node is added or removed, which on
 * this app happens a handful of times per page. Plus one `ResizeObserver` over
 * at most MAX_CANDIDATES nodes. The landing page's 1.6s budget pays nothing for
 * it: the caller arms this only after the tag has been injected, which is itself
 * behind `load` + an idle tick.
 */

/** Below this, a node is a pixel or a container, not a push card. */
const MIN_W = 80;
const MIN_H = 30;
/** Ceiling on tracked nodes, so a chatty page cannot grow this without bound. */
const MAX_CANDIDATES = 40;
/** Never adopt these — they have no box and can never be the widget. */
const IGNORED = /^(SCRIPT|LINK|STYLE|META|TITLE|TEMPLATE|NOSCRIPT)$/;

/**
 * Watch for a skip. Calls `onSkip` at most once, then stops watching.
 * Returns a teardown that is always safe to call.
 */
export function watchInPagePushSkip(onSkip: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => {};
  }

  /** Nodes that appeared after we armed — the network's, by timing. */
  const candidates = new Set<Element>();
  /** Of those, the ones that were ever big enough to have been seen. */
  const shown = new Set<Element>();
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    stop();
    onSkip();
  };

  const resize =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) => {
          for (const entry of entries) {
            const el = entry.target;
            const { width, height } = el.getBoundingClientRect();
            if (width >= MIN_W && height >= MIN_H) {
              shown.add(el);
            } else if (shown.has(el) && width === 0 && height === 0) {
              // It was on screen and has collapsed — `display:none`, or the
              // network tore its own box down. That is a dismissal.
              finish();
              return;
            }
          }
        });

  const adopt = (node: Node) => {
    if (done || node.nodeType !== 1) return;
    const el = node as Element;
    if (IGNORED.test(el.tagName)) return;
    if (candidates.size >= MAX_CANDIDATES) return;
    candidates.add(el);
    // Measure once immediately: a widget inserted at full size never resizes,
    // so waiting for a ResizeObserver callback alone could miss it.
    const r = el.getBoundingClientRect();
    if (r.width >= MIN_W && r.height >= MIN_H) shown.add(el);
    resize?.observe(el);
  };

  const mutations = new MutationObserver((records) => {
    if (done) return;
    for (const rec of records) {
      for (const n of rec.addedNodes) adopt(n);
      for (const n of rec.removedNodes) {
        if (n.nodeType !== 1) continue;
        if (shown.has(n as Element)) {
          // A node that was visible has left the DOM — the dismissal shape.
          finish();
          return;
        }
        candidates.delete(n as Element);
      }
    }
  });

  function stop() {
    mutations.disconnect();
    resize?.disconnect();
    candidates.clear();
    shown.clear();
  }

  /* childList only, subtree deliberately off — see the cost note above. Both
     roots, because a self-placing tag may attach to either (production showed
     Monetag's own container going to <html> and an iframe to <body>). */
  mutations.observe(document.documentElement, { childList: true });
  if (document.body) mutations.observe(document.body, { childList: true });

  return () => {
    done = true;
    stop();
  };
}
