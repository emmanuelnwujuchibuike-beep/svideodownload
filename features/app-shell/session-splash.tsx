"use client";

import { useEffect, useRef, useState } from "react";

import { WelcomeOverlay } from "@/features/app-shell/brand-splash";

/** How long the app must have been hidden before returning counts as a real
 *  "minimized and came back" — not a quick glance at another app/notification. */
const AWAY_THRESHOLD_MS = 15_000;
/** How long the overlay itself stays up — brief, a resume transition, not the
 *  longer first-impression beat `BrandSplash` gets. */
const SHOW_MS = 1100;

/**
 * The TikTok/Twitter-style "welcome back" moment — the same premium full-screen
 * F (`WelcomeOverlay`) as the first-ever-visit `BrandSplash`, but retriggered on
 * two more occasions: right after a fresh sign-in, and whenever the app resumes
 * after being minimized/backgrounded for a while. Mounted once in the signed-in
 * app shell (`app/(app)/layout.tsx`) so it covers whatever page the user lands
 * back on, not just /home.
 */
export function SessionSplash() {
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setVisible(true);
    document.body.style.overflowY = "hidden";
    hideTimer.current = setTimeout(() => {
      setVisible(false);
      document.body.style.overflowY = "";
    }, SHOW_MS);
  };

  // Trigger 1 — a fresh sign-in. `auth-panel.tsx` (password + OTP paths) and
  // `app/auth/callback/route.ts` (Google/magic-link) all set this short-lived
  // cookie right at the moment sign-in actually succeeds, immediately before
  // the redirect into the app — read-and-clear once, so it can only ever fire
  // the one time it's meant to.
  useEffect(() => {
    try {
      if (!document.cookie.includes("frenz_just_signed_in=1")) return;
      document.cookie = "frenz_just_signed_in=; path=/; max-age=0; SameSite=Lax";
      trigger();
    } catch {
      /* cookies blocked — no splash, not worth failing anything over */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger 2 — resume from background. Tracks how long the tab/installed app
  // was actually hidden; only a meaningfully long absence counts (a quick
  // glance at a notification shouldn't repaint the whole app with a splash).
  useEffect(() => {
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt === null) return;
      const away = Date.now() - hiddenAt;
      hiddenAt = null;
      if (away >= AWAY_THRESHOLD_MS) trigger();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  return <WelcomeOverlay visible={visible} label="Welcome back" />;
}
