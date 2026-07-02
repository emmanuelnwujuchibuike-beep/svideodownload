"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";

/**
 * Home-screen install prompt, per platform:
 *  - Android/desktop Chrome fires `beforeinstallprompt` → we show a banner with
 *    a real one-tap Install button (native install sheet).
 *  - iOS Safari never fires it and needs the manual path → instruction banner
 *    (Share → Add to Home Screen), which is also the only way iPhones can
 *    receive Web Push (Safari 16.4+).
 * Dismiss snoozes for 14 days. Hidden when already installed (standalone).
 */

const DISMISS_KEY = "frenz:ios-install-dismissed";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIosNeedingInstall(): boolean {
  const ua = navigator.userAgent;
  const isIos =
    /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ reports as Mac; touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return isIos && !isStandalone() && !("PushManager" in window);
}

function snoozed(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < SNOOZE_MS;
  } catch {
    return false;
  }
}

export function IosInstallPrompt() {
  const [mode, setMode] = useState<"hidden" | "ios" | "android">("hidden");
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || isStandalone() || snoozed()) return;

    // Android/desktop: the browser tells us installation is available.
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
      setMode("android");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS: no event ever fires — detect and instruct.
    let t: ReturnType<typeof setTimeout> | null = null;
    if (isIosNeedingInstall()) {
      t = setTimeout(() => setMode((m) => (m === "hidden" ? "ios" : m)), 2500);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      if (t) clearTimeout(t);
    };
  }, []);

  const dismiss = () => {
    setMode("hidden");
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  };

  const install = async () => {
    if (!installEvt) return;
    setMode("hidden");
    try {
      await installEvt.prompt();
      const { outcome } = await installEvt.userChoice;
      if (outcome === "dismissed") {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <AnimatePresence>
      {mode !== "hidden" ? (
        <motion.div
          initial={{ y: 96, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 96, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="fixed inset-x-3 bottom-20 z-[70] mx-auto max-w-md lg:bottom-6"
          role="dialog"
          aria-label="Install Frenz"
        >
          <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-card/95 p-4 shadow-elevated backdrop-blur-xl">
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
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-snug">
                  {mode === "android" ? "Install the Frenz app" : "Get instant notifications on your iPhone"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {mode === "android"
                    ? "Add Frenz to your home screen for instant push notifications, faster launches and a full-screen app feel."
                    : "Add Frenz to your Home Screen to receive push notifications for messages, likes and new followers — even when Safari is closed."}
                </p>
                {mode === "android" ? (
                  <button
                    type="button"
                    onClick={install}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95"
                  >
                    <Download className="h-4 w-4" /> Install app
                  </button>
                ) : (
                  <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs font-medium">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2 py-1">
                      Tap <Share className="h-3.5 w-3.5 text-blue-500" /> Share
                    </span>
                    <span className="text-muted-foreground">then</span>
                    <span className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2 py-1">
                      <SquarePlus className="h-3.5 w-3.5 text-violet-500" /> Add to Home Screen
                    </span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
