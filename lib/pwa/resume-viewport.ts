"use client";

import { useEffect } from "react";

import { isIos } from "./platform";

/**
 * 🔴 iOS LEAVES THE VIEWPORT STALE AFTER THE APP RETURNS (owner, 2026-10-10:
 * "the bottom NAV always goes up when I leave the pwa and comes back … I have
 * to exit the app and come back before it fixed").
 *
 * WebKit, mostly in the installed PWA, resumes from the background (or from a
 * system sheet such as the file picker) with the layout viewport still sized
 * as it was while the sheet or keyboard covered it. Everything `position:
 * fixed; bottom` — the floating nav first — is anchored to that short
 * viewport, so it floats mid-screen over a blank strip until something makes
 * WebKit lay the page out again.
 *
 * A scroll is that something. On resume this drops focus left on a file input,
 * then nudges the scroll position one pixel and back: invisible, and it makes
 * WebKit recompute the viewport. It runs twice because iOS settles the size a
 * beat after `visibilitychange`. iOS only — no other engine has the bug.
 */
export function repairViewport(
  win: Pick<Window, "scrollX" | "scrollY" | "scrollTo" | "innerHeight"> & { visualViewport?: { height: number } | null } = window,
  doc: Pick<Document, "activeElement"> & { documentElement?: { style: { minHeight: string } } } = document,
): void {
  const active = doc.activeElement as (Element & { type?: string; blur?: () => void; tagName?: string; isContentEditable?: boolean }) | null;
  if (active?.type === "file") active.blur?.();
  /*
    🔴 2026-10-12 (owner: "the bottom nav goes up to the middle and the top header disappears"
    after coming back to a minimised tab or PWA). The paste box is the usual culprit: left
    focused when the app went to the background, iOS restores the page laid out for a keyboard
    that is no longer there. A text field that still has focus while the keyboard is NOT up
    (the visual viewport is nearly the full window) is stale focus — drop it, and WebKit lays
    the page out for the real, full viewport.
  */
  const tag = active?.tagName?.toLowerCase();
  const typing = tag === "textarea" || active?.isContentEditable || (tag === "input" && !["button", "checkbox", "radio", "range", "file", "submit", "reset", "color"].includes(active?.type ?? "text"));
  const vv = win.visualViewport;
  if (typing && vv && win.innerHeight && vv.height >= win.innerHeight * 0.85) active?.blur?.();
  /*
    🔴 2026-10-29 (owner: the chat header slid under the clock and the bottom nav rose after minimising). A page that
    cannot scroll — a chat thread is one fixed screen — ignored the one-pixel nudge, so nothing was laid out again. For
    the nudge only, the page is one pixel taller than the screen, then put back.
  */
  const root = doc.documentElement;
  const prev = root?.style.minHeight ?? "";
  if (root) root.style.minHeight = "calc(100% + 1px)";
  const x = win.scrollX;
  const y = win.scrollY;
  win.scrollTo(x, y + 1);
  win.scrollTo(x, y);
  if (root) root.style.minHeight = prev;
}

/** Mount once, app-wide (the bottom nav does). */
export function useResumeViewportRepair(): void {
  useEffect(() => {
    if (!isIos()) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      if (document.visibilityState !== "visible") return;
      requestAnimationFrame(() => repairViewport());
      timers.forEach(clearTimeout);
      // iOS settles the size a beat after it shows the page — and on a slow resume, a second beat after that
      timers = [setTimeout(() => repairViewport(), 350), setTimeout(() => repairViewport(), 900)];
    };
    const onShow = (e: PageTransitionEvent) => e.persisted && run();
    document.addEventListener("visibilitychange", run);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("focus", run);
    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", run);
    };
  }, []);
}
