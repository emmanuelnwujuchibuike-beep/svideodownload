"use client";

import { useEffect } from "react";

/**
 * Keeps `<meta name="theme-color">` matched to the app's ACTUAL resolved theme, so
 * iOS Safari (and Android Chrome) tint the status-bar / notch / address-bar area
 * with the app's background — making the plain BROWSER blend edge-to-edge into the
 * safe area exactly like the installed webapp does (owner, 2026-08: "i want the
 * browser to be like the webapp that goes to the top safe areas ... only the theme,
 * color, videos, images ... buttons shouldnt go there"). `viewport-fit=cover` +
 * `--frenz-safe-top` already keep backgrounds/media full-bleed and buttons clear;
 * this is the last piece — the colour behind the system bars.
 *
 * Next emits two media-scoped theme-color metas (one per OS colour-scheme). iOS
 * picks by the OS scheme, which is WRONG here: the app has its own light/dark
 * toggle that can disagree with the OS (dark app on a light phone → a white bar).
 * So this removes the media-scoped metas and manages ONE meta whose colour follows
 * `html.dark`, updated live whenever the theme changes (toggle or system).
 */
const DARK = "#050816"; // globals.css dark --background
const LIGHT = "#ffffff";

export function ThemeColorSync() {
  useEffect(() => {
    const root = document.documentElement;

    const apply = () => {
      const color = root.classList.contains("dark") ? DARK : LIGHT;
      // Drop the OS-scheme-scoped metas so iOS can't pick the wrong one.
      document.querySelectorAll('meta[name="theme-color"][media]').forEach((m) => m.remove());
      let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "theme-color");
        document.head.appendChild(meta);
      }
      if (meta.getAttribute("content") !== color) meta.setAttribute("content", color);
    };

    apply();
    // The theme toggle / boot script flips `html.dark`; mirror it onto the meta.
    const obs = new MutationObserver(apply);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return null;
}
