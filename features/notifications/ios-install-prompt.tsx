"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Share, SquarePlus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";

/**
 * iOS Safari can't deliver Web Push from a browser tab — Apple only allows it for
 * web apps installed on the Home Screen (Safari 16.4+, `display: standalone`).
 * This banner detects that exact situation and walks the user through installing:
 * Share → Add to Home Screen. Hidden everywhere else (Android/desktop support
 * push directly; installed iOS apps already have it). Dismiss snoozes for 14 days.
 */

const DISMISS_KEY = "frenz:ios-install-dismissed";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

function needsHomeScreenForPush(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos =
    /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ reports as Mac; touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIos) return false;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  // Already installed, or this iOS version supports push in-browser: nothing to do.
  return !standalone && !("PushManager" in window);
}

export function IosInstallPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!needsHomeScreenForPush()) return;
    try {
      const dismissed = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      if (Date.now() - dismissed < SNOOZE_MS) return;
    } catch {
      /* storage unavailable — still show */
    }
    // Let the page settle first so the prompt feels considered, not spammy.
    const t = setTimeout(() => setShow(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  };

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          initial={{ y: 96, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 96, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="fixed inset-x-3 bottom-20 z-[70] mx-auto max-w-md lg:bottom-6"
          role="dialog"
          aria-label="Install Frenz for notifications"
        >
          <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-card/95 p-4 shadow-elevated backdrop-blur-xl">
            {/* Brand glow accent */}
            <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br from-blue-500/25 to-violet-500/25 blur-2xl" />
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="absolute right-2.5 top-2.5 rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-start gap-3">
              <FrenzLogo size={40} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug">
                  Get instant notifications on your iPhone
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Add Frenz to your Home Screen to receive push notifications for messages,
                  likes and new followers — even when Safari is closed.
                </p>
                <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs font-medium">
                  <span className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2 py-1">
                    Tap <Share className="h-3.5 w-3.5 text-blue-500" /> Share
                  </span>
                  <span className="text-muted-foreground">then</span>
                  <span className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2 py-1">
                    <SquarePlus className="h-3.5 w-3.5 text-violet-500" /> Add to Home Screen
                  </span>
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
