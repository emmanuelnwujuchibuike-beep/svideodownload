/**
 * `navigator.serviceWorker`, guarded.
 *
 * ── The trap (2026-09-13, third layer of the AdSense preview crash) ─────────
 *
 * In a sandboxed / opaque-origin embed `"serviceWorker" in navigator` is TRUE
 * — the property exists — but READING it throws:
 *
 *   SecurityError: Failed to read the 'serviceWorker' property from
 *   'Navigator': Service worker is disabled because the context is sandboxed
 *   and lacks the 'allow-same-origin' flag.
 *
 * So the usual `in` check passes and the very next line, inside a mount
 * effect on every page, takes the root layout down to the last-resort
 * boundary. Same family as `document.cookie` (lib/dom/cookie.ts) and
 * `localStorage`: a browser API that throws on access rather than returning
 * nothing. The answer is the same — an unavailable container is `null`, never
 * an exception.
 */
export function serviceWorkerContainer(): ServiceWorkerContainer | null {
  if (typeof navigator === "undefined") return null;
  try {
    if (!("serviceWorker" in navigator)) return null;
    return navigator.serviceWorker ?? null;
  } catch {
    return null;
  }
}
