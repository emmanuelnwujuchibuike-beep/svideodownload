"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PICTURE-IN-PICTURE (Feature 15, Part 2 — tranche 2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Picture-in-Picture (where supported)."
 *
 * ── "Where supported" is doing real work in that sentence ─────────────────
 *
 * PiP is the least evenly implemented control in this whole feature:
 *
 *  • Chrome, Edge, Firefox and desktop Safari: the standard
 *    `HTMLVideoElement.requestPictureInPicture()`.
 *  • iPhone Safari: no standard API. It has `webkitSetPresentationMode`, and
 *    on iPhone it only works when the video is ALREADY playing inline with the
 *    user's involvement. It is offered because it is what iPhone users expect
 *    from a video, and it is guarded because it throws when it will not run.
 *  • Everywhere else, and any document that sets the `picture-in-picture`
 *    permissions policy off: nothing. The control is not rendered at all —
 *    a button that visibly does nothing is worse than no button.
 *
 * ── Why the element must be checked, not just the document ────────────────
 *
 * `document.pictureInPictureEnabled` says the DOCUMENT may use PiP. A specific
 * `<video>` can still refuse: `disablePictureInPicture`, no video track yet, or
 * an audio-only stream. Both are checked, and support is re-evaluated when the
 * element changes — a reel deck swaps elements constantly as cards mount.
 */

/*
 * The vendor-prefixed members are declared as an INTERSECTION rather than by
 * extending the DOM types. `disablePictureInPicture` and
 * `pictureInPictureEnabled` are already non-optional in lib.dom, and redeclaring
 * them as optional is a type error — but they are genuinely absent on the
 * engines this file exists to handle, so they are read defensively below.
 */
type PipVideo = HTMLVideoElement & {
  webkitSetPresentationMode?: (mode: "picture-in-picture" | "inline") => void;
  webkitSupportsPresentationMode?: (mode: string) => boolean;
};

type PipDocument = Document & {
  exitPictureInPicture?: () => Promise<void>;
};

export interface PipControl {
  supported: boolean;
  active: boolean;
  toggle: () => void;
}

export function usePictureInPicture(video: HTMLVideoElement | null): PipControl {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const doc = document as PipDocument;
    const el = video as PipVideo | null;
    if (!el) {
      setSupported(false);
      return;
    }

    const standard =
      doc.pictureInPictureEnabled === true &&
      typeof el.requestPictureInPicture === "function" &&
      el.disablePictureInPicture !== true;
    const webkit =
      typeof el.webkitSetPresentationMode === "function" &&
      // 🔴 Ask the ELEMENT, not the browser. iPhone Safari exposes the method on
      // every video and refuses it on many — `webkitSupportsPresentationMode` is
      // the only honest answer, and it is false until metadata has loaded, which
      // is why this effect re-runs on the element.
      el.webkitSupportsPresentationMode?.("picture-in-picture") === true;

    setSupported(standard || webkit);

    const onEnter = () => setActive(true);
    const onLeave = () => setActive(false);
    el.addEventListener("enterpictureinpicture", onEnter);
    el.addEventListener("leavepictureinpicture", onLeave);
    // Safari reports the transition through presentation mode instead.
    const onPresentation = () => {
      const mode = (el as unknown as { webkitPresentationMode?: string }).webkitPresentationMode;
      if (mode) setActive(mode === "picture-in-picture");
    };
    el.addEventListener("webkitpresentationmodechanged", onPresentation);
    return () => {
      el.removeEventListener("enterpictureinpicture", onEnter);
      el.removeEventListener("leavepictureinpicture", onLeave);
      el.removeEventListener("webkitpresentationmodechanged", onPresentation);
    };
    // `readyState` is in the deps because `webkitSupportsPresentationMode` only
    // becomes true once the element has metadata — without it the control would
    // stay hidden on iPhone for the entire first clip.
  }, [video, video?.readyState]);

  const toggle = useCallback(() => {
    const doc = document as PipDocument;
    const el = video as PipVideo | null;
    if (!el) return;
    try {
      if (doc.pictureInPictureElement === el) {
        void doc.exitPictureInPicture?.();
        return;
      }
      if (typeof el.requestPictureInPicture === "function" && doc.pictureInPictureEnabled) {
        // A rejected request (gesture spent, permissions policy, a race with the
        // element being torn down) must never surface as an unhandled rejection —
        // the button simply does nothing.
        void el.requestPictureInPicture().catch(() => {});
        return;
      }
      el.webkitSetPresentationMode?.("picture-in-picture");
    } catch {
      /* refused — nothing to recover, and nothing worth interrupting for */
    }
  }, [video]);

  return { supported, active, toggle };
}
