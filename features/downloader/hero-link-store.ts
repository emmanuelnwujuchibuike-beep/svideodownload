"use client";

/**
 * The link the landing hero's CTA is currently showing a result for.
 *
 * ── Why a store and not a query string ────────────────────────────────────────
 * The CTA used to be a real GET form: submitting it navigated to `/?paste=…`.
 * That worked, and it was wrong (owner, 2026-08-09): "clicking on the download
 * button on the hero section shouldn't refresh and animate the page like it's
 * entering another page… it should show the review instantly."
 *
 * A navigation re-runs the whole page — router transition, re-render, and the
 * app's own page-transition animation — to end up on the page you were already
 * on. The result panel is a few rows below the button; nothing needs to move.
 *
 * ── Why a store and not props ─────────────────────────────────────────────────
 * The form and the result panel are separated by two other CTA rows in the
 * hero's markup. Lifting state to share them would turn the entire CTA stack
 * into one client component and drag its static markup into the bundle of the
 * one page with the tightest budget on the site. Two small islands and eleven
 * lines of shared state is far cheaper, and it keeps everything between them
 * server-rendered.
 *
 * ── The form still works without JavaScript ───────────────────────────────────
 * It remains a real `<form action="/" method="get">`; the island only calls
 * `preventDefault` once it has hydrated. Before that — and for anyone who
 * arrives on a `?paste=` link — the old navigation path still produces the same
 * result panel. Progressive enhancement, not a JS-only feature.
 */

let current = "";
const listeners = new Set<() => void>();

export function setHeroLink(url: string): void {
  current = url;
  for (const l of listeners) l();
}

export function subscribeHeroLink(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getHeroLink(): string {
  return current;
}

/** Nothing is submitted during a prerender — and this must be a stable value. */
export function getServerHeroLink(): string {
  return "";
}
