"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Space_Grotesk } from "next/font/google";
import { useEffect, useState } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";

// A distinctive display face for the wordmark ONLY — the app's one body/UI
// font stays Plus Jakarta Sans everywhere else (see app/layout.tsx). Scoped
// this tightly (a single splash moment) rather than adopting a second font
// app-wide.
const wordmarkFont = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600"] });

/**
 * The premium full-screen "F" welcome overlay (TikTok/Twitter-style splash) —
 * shown ONLY on first-ever login and after site data/cookies were cleared
 * (owner spec: never on a plain refresh or an ordinary repeat sign-in). Purely
 * presentational — `BrandSplash` below owns the one trigger that's actually
 * wired up, gated server-side on the `frenz_welcomed` cookie.
 *
 * Background is a hardcoded white (owner ask, 2026-07-11), not the
 * theme-aware `bg-background` — this is the one surface meant to look the
 * same, colorful-logo-on-white, regardless of the visitor's light/dark
 * preference, matching the PWA icons' own white-background treatment.
 */
export function WelcomeOverlay({ visible, label = "Loading Frenz" }: { visible: boolean; label?: string }) {
  return (
    <AnimatePresence onExitComplete={() => (document.body.style.overflowY = "")}>
      {visible ? (
        <motion.div
          key="frenz-splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white"
          role="status"
          aria-label={label}
        >
          {/* Soft brand glow */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute h-64 w-64 rounded-full bg-violet-600/25 blur-3xl"
            animate={{ scale: [0.9, 1.12, 0.9], opacity: [0.35, 0.7, 0.35] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            initial={{ scale: 0.82, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex flex-col items-center gap-4"
          >
            <FrenzLogo size={96} priority className="drop-shadow-[0_8px_30px_rgba(139,92,246,0.45)]" />
            <motion.span
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.5 }}
              className={`text-gradient ${wordmarkFont.className} text-xl font-medium tracking-wide`}
            >
              Frenz
            </motion.span>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * First-open brand splash (Facebook/Twitter style). Premium, lightweight,
 * transform/opacity-only animation. It is rendered ONLY on the very first /home
 * open — the server gates it on the `frenz_welcomed` cookie, so it never mounts
 * (and never flashes) on repeat visits or any other page. Nothing else loads with
 * it: it's a full-screen opaque overlay that fades out to reveal the ready home.
 */
export function BrandSplash() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Mark as welcomed immediately so it can't reappear mid-session, and lock
    // scroll while the splash is up.
    document.cookie = "frenz_welcomed=1; path=/; max-age=31536000; SameSite=Lax";
    // overflowY only — the `overflow` shorthand also resets overflow-x, undoing
    // the `overflow-x: clip` on <body> that keeps the app sidebar sticky.
    document.body.style.overflowY = "hidden";
    const t = setTimeout(() => setVisible(false), 1500);
    return () => {
      clearTimeout(t);
      document.body.style.overflowY = "";
    };
  }, []);

  return <WelcomeOverlay visible={visible} />;
}
