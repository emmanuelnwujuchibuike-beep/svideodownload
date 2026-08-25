"use client";

import { useSyncExternalStore } from "react";

import { isBodyScrollLocked } from "./scroll-lock";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  "IS A FULLSCREEN OVERLAY COVERING THE PAGE RIGHT NOW?" — as a subscription
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `lib/dom/scroll-lock.ts` documents the convention every fullscreen viewer and
 * sheet in this app already follows: set `document.body.style.overflowY =
 * "hidden"` while open, restore it on close. `isBodyScrollLocked()` reads it,
 * and `features/app-shell/edge-swipe-back.tsx` already makes a real decision
 * from it — so "the body is locked" is ALREADY this codebase's meaning of "the
 * page beneath is covered".
 *
 * What was missing is that the reader is a poll: fine inside a gesture handler,
 * useless to a component that has to RE-RENDER when the state flips. This
 * makes the same signal observable, without touching the ~14 call sites that
 * set it.
 *
 * ── Why a MutationObserver and not a store with a setter ──────────────────
 *
 * A store would be the tidier design and is the eventual one — but it only
 * works once ALL ~14 lock sites call the setter, and a single one left behind
 * is an overlay that silently does not register. `scroll-lock.ts` explicitly
 * defers that migration as its own cleanup. Observing the attribute those 14
 * sites already write is correct for every one of them on day one, including
 * any added later by someone who never reads this file.
 *
 * The observer is scoped to `<body>`'s `style` attribute alone, and only exists
 * while something is subscribed — this is not a global listener.
 *
 * 🔴 It reports the CONVENTION, not the intent: anything that locks body scroll
 * counts, including bottom sheets. That is the right granularity for chrome
 * that must get out of the way of whatever is on top of it, and the wrong one
 * for anything trying to identify WHICH overlay is open. Do not use it for the
 * latter.
 */
export function useBodyScrollLocked(): boolean {
  return useSyncExternalStore(subscribe, isBodyScrollLocked, serverSnapshot);
}

function subscribe(onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { attributes: true, attributeFilter: ["style"] });
  return () => observer.disconnect();
}

// Never locked during SSR — there is no overlay on a freshly-rendered document,
// and claiming otherwise would hydrate the chrome away for a frame.
function serverSnapshot(): boolean {
  return false;
}
