"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bell, BellRing, Check, Loader2, Settings, X } from "lucide-react";
import { useEffect, useState } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { useUser } from "@/features/auth/use-user";
import { enablePush, pushSupported, syncPush } from "@/features/notifications/push";

/**
 * The missing last mile of Web Push: permission must be granted by a button tap
 * INSIDE the running app (on iOS, inside the installed home-screen app — Apple
 * ignores requests from plain browser tabs). The only enable button used to be
 * buried in the Notification Center header, so people who installed the PWA
 * never actually subscribed and concluded push was broken. This nudge:
 *  - silently repairs the subscription when permission is already granted;
 *  - otherwise shows an Enable banner until push is truly on;
 *  - on iOS browser tabs, defers to the install prompt (push can't work there);
 *  - offers a test notification so delivery is verifiable on the spot;
 *  - snoozes per session on dismiss, stops for good once subscribed.
 */

const DISMISS_KEY = "frenz:push-nudge-dismissed-session";

function isIos(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function dismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

type Phase = "hidden" | "ask" | "denied" | "enabled";

export function PushNudge() {
  const [phase, setPhase] = useState<Phase>("hidden");
  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  // Subscribing is an authed action (the /u shell also renders for anonymous
  // visitors) — never nudge someone who couldn't complete it.
  const { user, loading } = useUser();

  useEffect(() => {
    if (typeof window === "undefined" || !pushSupported() || loading || !user) return;

    // Permission already granted → no UI needed, just keep the server row alive.
    if (Notification.permission === "granted") {
      void syncPush();
      return;
    }
    if (dismissedThisSession()) return;
    // iOS browser tab: push only works from the installed app — the install
    // prompt owns that journey; asking for permission here would fail anyway.
    if (isIos() && !isStandalone()) return;

    // If the browser offers its install banner this session, let it have the
    // slot; we'll ask on the next launch (post-install, as standalone).
    let installOffered = false;
    const onInstallPrompt = () => {
      installOffered = true;
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);

    const t = setTimeout(() => {
      if (installOffered) return;
      setPhase(Notification.permission === "denied" ? "denied" : "ask");
    }, 3000);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      clearTimeout(t);
    };
  }, [user, loading]);

  const dismiss = () => {
    setPhase("hidden");
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const enable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const state = await enablePush();
      if (state === "subscribed") setPhase("enabled");
      else if (state === "denied") setPhase("denied");
      else dismiss();
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    if (testState === "sending") return;
    setTestState("sending");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      setTestState(res.ok ? "sent" : "failed");
    } catch {
      setTestState("failed");
    }
  };

  return (
    <AnimatePresence>
      {phase !== "hidden" ? (
        <motion.div
          initial={{ y: 96, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 96, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="fixed inset-x-3 bottom-20 z-[70] mx-auto max-w-md lg:bottom-6"
          role="dialog"
          aria-label="Enable notifications"
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
                {phase === "enabled" ? (
                  <>
                    <p className="flex items-center gap-1.5 text-sm font-semibold leading-snug">
                      <Check className="h-4 w-4 text-emerald-500" /> Notifications are on
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      This device will now get messages, likes and new followers even when the app is closed
                      {isIos() ? " or your iPhone is locked" : ""}.
                    </p>
                    <div className="mt-2.5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={sendTest}
                        disabled={testState === "sending" || testState === "sent"}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 disabled:opacity-60"
                      >
                        {testState === "sending" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <BellRing className="h-4 w-4" />
                        )}
                        {testState === "sent" ? "Test sent — check your notifications" : testState === "failed" ? "Try the test again" : "Send a test notification"}
                      </button>
                      {testState === "sent" ? (
                        <button type="button" onClick={dismiss} className="rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                          Done
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : phase === "denied" ? (
                  <>
                    <p className="text-sm font-semibold leading-snug">Notifications are blocked</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {isIos()
                        ? "Open the Settings app, then Notifications, find Frenz in the list and allow notifications. After that, messages and likes reach your lock screen."
                        : "Notifications were blocked for this site in your browser settings. Allow them there, then come back and turn on push."}
                    </p>
                    <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/60 px-3.5 py-2 text-xs font-medium text-muted-foreground">
                      <Settings className="h-4 w-4" /> Settings → Notifications → Frenz
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold leading-snug">Turn on notifications</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Get messages, likes and new followers the moment they happen — even when the app is closed
                      {isIos() ? " or your iPhone is locked" : ""}.
                    </p>
                    <button
                      type="button"
                      onClick={enable}
                      disabled={busy}
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />} Enable notifications
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
