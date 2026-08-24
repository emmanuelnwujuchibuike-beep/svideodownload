/**
 * Global media protection — the JavaScript half.
 *
 * Owner (2026-08-24): long-pressing a wallpaper raised iOS's own image sheet —
 * Save to Photos / Copy / Copy Subject / Look Up. This suppresses the browser's
 * casual save/copy affordances on media across the whole app.
 *
 * ── 🔴 WHAT THIS IS NOT ───────────────────────────────────────────────────
 * It is not DRM and must never be described as such. Media that reaches a
 * browser can always be extracted — screenshots, devtools, the network tab,
 * a camera pointed at the screen. The goal is narrower and achievable: remove
 * the ONE-GESTURE path (long-press → Save to Photos, right-click → Save Image,
 * drag to desktop) so saving is a deliberate act through Frenzsave's own
 * download UI rather than an accident of the platform.
 *
 * ── The division of labour with CSS ───────────────────────────────────────
 * Most of the work is NOT here. `app/globals.css` carries the real iOS fix —
 * `-webkit-touch-callout: none` on media elements — which costs zero bytes of
 * JavaScript, applies before hydration and cannot be missed by a component
 * that forgot to opt in. This file exists only for the two things CSS cannot
 * express: the desktop/Android `contextmenu` menu, and HTML5 `dragstart`.
 *
 * ── Why this is cheap enough to be global ─────────────────────────────────
 * TWO delegated listeners, for the life of the document. Neither is a touch or
 * scroll event, so neither can cost a frame: `contextmenu` fires on a
 * right-click or a completed long-press, `dragstart` on a drag — a handful of
 * times in a session, never during a scroll. There is no MutationObserver, no
 * DOM sweep and no polling, so lazy-loaded, infinite-scrolled, modal,
 * fullscreen and post-navigation media are all covered for free: delegation
 * asks the question at event time, when the element definitively exists.
 */

/**
 * What counts as protected. Element TYPES, not a marker class — so a media
 * component written next year is covered without anyone remembering to opt in,
 * which is the failure mode of every "add this attribute" scheme.
 *
 * `[data-media-protected]` is the escape hatch UPWARD: a full-bleed viewer
 * whose touch target is a wrapper rather than the image itself marks that
 * wrapper. See the CSS block for the matching declarations.
 */
const PROTECTED = "img,video,picture,canvas,[data-media-protected]";

/**
 * The escape hatch DOWNWARD, for the case where a native menu is the feature —
 * a user's own upload preview they should be able to save back, say. Nothing
 * uses it today; it exists so the answer to "we need the menu here" is one
 * attribute rather than an exception carved into this file.
 */
const OPT_OUT = "[data-media-unprotected]";

/**
 * The decision, over the only capability it needs.
 *
 * Split out from the event handler so it is testable in this project's plain
 * node test environment — the alternative was pulling in jsdom for two
 * `closest()` calls, and "no new dependency" is an explicit requirement of
 * this feature.
 */
export function isProtectedTarget(el: { closest(selector: string): unknown } | null): boolean {
  if (!el) return false;
  // Opt-out wins, and is checked first so it can override a nested match.
  if (el.closest(OPT_OUT)) return false;
  return !!el.closest(PROTECTED);
}

function isProtectedMedia(target: EventTarget | null): boolean {
  // `typeof` guard, not a bare `instanceof`: this module is imported from a
  // client component, and a bare `instanceof Element` would throw if it were
  // ever evaluated where the DOM does not exist.
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return isProtectedTarget(target);
}

/**
 * 🔴 `preventDefault` ONLY — never `stopPropagation`.
 *
 * The app has its own press-and-hold menus (`lib/dom/use-long-press.ts`,
 * `lib/hooks/use-long-press.ts`) that listen for the same `contextmenu` event
 * to open Frenzsave's action sheet. Stopping propagation here would silence
 * them and trade the OS menu for no menu at all. Suppressing the DEFAULT
 * leaves every application handler downstream intact.
 */
function suppressNativeMenu(event: Event): void {
  if (isProtectedMedia(event.target)) event.preventDefault();
}

/**
 * Capture phase, on the document.
 *
 * React attaches its synthetic listeners at the root container, which is a
 * DESCENDANT of the document — so a bubble-phase listener here runs last and
 * can be pre-empted by any component that calls `stopPropagation`. Capture
 * runs before all of them and cannot be. It still does not interfere: a
 * capture-phase `preventDefault` does not stop the event reaching React, so
 * application handlers fire exactly as before.
 */
const OPTIONS: AddEventListenerOptions = { capture: true };

/**
 * Attach the protection. Returns a detacher.
 *
 * Safe to call more than once: the listener is a stable module-level function,
 * and the DOM ignores a duplicate (type, listener, capture) registration — so
 * React StrictMode's double-invoked effects cannot stack handlers.
 */
export function attachMediaProtection(doc: Document = document): () => void {
  doc.addEventListener("contextmenu", suppressNativeMenu, OPTIONS);
  doc.addEventListener("dragstart", suppressNativeMenu, OPTIONS);
  return () => {
    doc.removeEventListener("contextmenu", suppressNativeMenu, OPTIONS);
    doc.removeEventListener("dragstart", suppressNativeMenu, OPTIONS);
  };
}

/** The selectors, exported so the test asserts against the real strings. */
export const MEDIA_SELECTORS = { PROTECTED, OPT_OUT } as const;
