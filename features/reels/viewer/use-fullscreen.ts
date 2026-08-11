"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FULLSCREEN, across two incompatible platform stories
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-11: "add a full screen button at the bottom right corner, tiny
 * to avoid cluster."
 *
 * ── What fullscreen actually buys here ─────────────────────────────────────
 * The reel deck is already `fixed inset-0`, so on an INSTALLED PWA it fills the
 * display and this control has nothing left to give. In a browser tab it has a
 * lot: it retracts the URL bar and the toolbar, which on a phone is roughly
 * 15% of the screen the video is currently not using. That is the case this
 * exists for, and it is why the button hides itself where it would be a no-op.
 *
 * ── Two APIs, and iOS has neither of the good ones ─────────────────────────
 * 1. The standard Fullscreen API on an arbitrary element. Chrome, Firefox,
 *    desktop Safari. Keeps our own chrome — the rail, the caption, the
 *    scrubber — because the element WE fullscreen is the deck, not the video.
 *
 * 2. iOS Safari on iPhone implements `Element.requestFullscreen` on nothing but
 *    the `<video>` element itself, via the non-standard
 *    `webkitEnterFullscreen`. That hands the clip to the NATIVE iOS player, so
 *    our overlay is gone for the duration and the system controls take over.
 *    It is a worse experience than (1) and it is the only one available, so it
 *    is offered rather than withheld — and it is why `native` is reported, so
 *    the caller can word the label honestly.
 *
 * 🔴 `webkitEnterFullscreen` throws if the element has not loaded metadata yet,
 * so the call is guarded rather than assumed to succeed. And neither API can be
 * invoked outside a user gesture — every path here runs from a click handler.
 */

interface WebkitVideo extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
}

interface WebkitDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

export interface FullscreenControl {
  /** Offer the control at all — false when it could do nothing. */
  supported: boolean;
  /** True while the standard API has us fullscreen (never true on the iOS path). */
  active: boolean;
  /** iOS hands the clip to the system player rather than fullscreening our UI. */
  native: boolean;
  toggle: () => void;
}

export function useFullscreen(
  target: { current: HTMLElement | null },
  video: { current: HTMLVideoElement | null },
): FullscreenControl {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);
  const [native, setNative] = useState(false);

  useEffect(() => {
    const doc = document as WebkitDocument;
    const standard = document.fullscreenEnabled === true;
    // Probed on a throwaway element: `webkitSupportsFullscreen` on the real one
    // is false until metadata loads, so asking it at mount would hide the button
    // on exactly the devices that need it.
    const iosVideo =
      !standard && typeof (document.createElement("video") as WebkitVideo).webkitEnterFullscreen === "function";

    /*
      🔴 Hidden in a standalone PWA: the display is already ours, so the control
      would toggle nothing a viewer can see. `display-mode: standalone` is the
      check — not a UA sniff — because it is the actual condition that makes
      this a no-op, and it is correct for every platform including a desktop
      installed app.
    */
    const standalone =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true);

    setSupported((standard || iosVideo) && !standalone);
    setNative(!standard && iosVideo);

    const onChange = () => setActive(!!(document.fullscreenElement ?? doc.webkitFullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const toggle = useCallback(() => {
    const doc = document as WebkitDocument;
    const current = document.fullscreenElement ?? doc.webkitFullscreenElement;
    if (current) {
      void (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
      return;
    }
    const el = target.current;
    if (document.fullscreenEnabled && el?.requestFullscreen) {
      // Never let a rejected request (a lost gesture, a permissions policy)
      // surface as an unhandled rejection — the button simply does nothing.
      void el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
      return;
    }
    const v = video.current as WebkitVideo | null;
    if (v && typeof v.webkitEnterFullscreen === "function") {
      try {
        v.webkitEnterFullscreen();
      } catch {
        /* metadata not loaded yet — nothing to do but ignore the tap */
      }
    }
  }, [target, video]);

  return { supported, active, native, toggle };
}
