"use client";

import { useEffect, useState } from "react";

import { isStandalone } from "@/lib/pwa/platform";

/**
 * iOS platform constraint, not a bug in our CSS: `apple-mobile-web-app-
 * status-bar-style: black-translucent` (app/layout.tsx) is what lets reels/
 * photos draw edge-to-edge under the Dynamic Island/notch — the only
 * status-bar style that allows that. Its trade-off, fixed by iOS itself with
 * no per-page or per-theme override, is that the status bar's own clock/
 * battery icons are ALWAYS light/white, for the lifetime of the standalone
 * session. That reads fine over the app's dark theme, but in LIGHT mode the
 * very top of the page (behind the status bar) is light-colored too — white
 * icons over a light background. This renders a barely-there dark gradient
 * strip exactly `env(safe-area-inset-top)` tall, standalone-only (a normal
 * Safari tab has its own opaque status bar and doesn't need this — the
 * `env()` value is 0 there anyway, but the standalone check avoids an
 * unnecessary fixed layer). Recommend confirming the exact opacity reads
 * well on a real device in both themes before considering this final.
 */
export function StatusBarScrim() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(isStandalone());
  }, []);

  if (!show) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[200]"
      style={{
        height: "env(safe-area-inset-top)",
        background: "linear-gradient(to bottom, rgba(0,0,0,0.32), rgba(0,0,0,0))",
      }}
    />
  );
}
