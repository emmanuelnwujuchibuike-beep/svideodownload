"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Copy, Download, Share, SquarePlus, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { hasExceededDeclines, recordDecline } from "@/lib/pwa/decline-tracker";
import { reportInstallEvent } from "@/lib/pwa/install-analytics";
import { classifyInstallPlatform, isIos, isIosInApp, isStandalone } from "@/lib/pwa/platform";

/**
 * Home-screen install prompt, per platform:
 *  - Android/desktop Chrome fires `beforeinstallprompt` → we show a banner with
 *    a real one-tap Install button (native install sheet).
 *  - iOS Safari (or Chrome/Firefox for iOS, which share the same OS share
 *    sheet) never fires it and needs the manual path → instruction banner
 *    (Share → Add to Home Screen), which is also the only way iPhones can
 *    receive Web Push (Safari 16.4+). Those chips are NOT buttons — Apple
 *    gives web pages no API to trigger the share sheet, so tapping them is
 *    expected to do nothing; the copy says so explicitly to avoid reading as
 *    a broken button.
 *  - iOS in-app browsers (Instagram/Facebook/TikTok/etc.) can't reach that
 *    share sheet at all, so even the manual steps don't work there — detected
 *    via UA and pointed at "copy the link, open it in your real browser".
 * Dismissing only snoozes for the current tab session — the banner returns on
 * the next visit/login and only stops for good once `isStandalone()` is true.
 * Shown regardless of sign-in state (installing the app is useful before an
 * account even exists); explicit dismisses are counted per device
 * (lib/pwa/decline-tracker.ts) and after 5 the banner stops for good on that
 * device until browser storage/history is cleared.
 */

const PROMPT_ID = "add-to-home-screen";
const DISMISS_KEY = "frenz:ios-install-dismissed-session";
const VIEWS_KEY = "frenz:install-engagement-views";
// Only interrupt people who are actually using the app: at least a 2nd page
// view this session, or one meaningful scroll on the current page.
const MIN_VIEWS = 2;
const SCROLL_PX = 600;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Every iOS browser is WebKit under Apple's rules and reaches "Add to Home
// Screen" through the same OS share sheet — Safari, Chrome, Firefox, Edge
// all need the identical manual step, none can skip it. We only use this to
// name the browser correctly in the instructions, not to change the flow.
function iosBrowserLabel(): string {
  const ua = navigator.userAgent;
  if (/CriOS/i.test(ua)) return "Chrome";
  if (/FxiOS/i.test(ua)) return "Firefox";
  if (/EdgiOS/i.test(ua)) return "Edge";
  if (/OPiOS/i.test(ua)) return "Opera";
  return "Safari";
}

function isIosNeedingInstall(): boolean {
  // Any touch-iOS device that isn't already installed still needs the manual
  // Add-to-Home-Screen path — that's the *only* way iPhones get Web Push
  // (Safari 16.4+). We must NOT gate on `PushManager`: modern iOS Safari exposes
  // it even in the browser tab, which previously hid this banner entirely.
  return isIos() && !isStandalone();
}

function dismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function platformForMode(mode: "ios" | "ios-inapp" | "android"): "ios" | "ios-inapp" | "android" | "desktop" {
  return classifyInstallPlatform(mode, navigator.userAgent);
}

export function IosInstallPrompt() {
  const [mode, setMode] = useState<"hidden" | "ios" | "ios-inapp" | "android">("hidden");
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [copied, setCopied] = useState(false);
  const [browserName, setBrowserName] = useState("Safari");

  // Engagement gate: never interrupt someone who just landed. This component
  // lives in the persistent shell (it does NOT remount per navigation), so
  // page views are counted from pathname changes; a real scroll also counts.
  // The banner only appears once either signal says they're actually using
  // the app.
  const pathname = usePathname();
  const engagedRef = useRef(false);
  const pendingEvtRef = useRef<BeforeInstallPromptEvent | null>(null);
  const pendingIosRef = useRef<"ios" | "ios-inapp" | null>(null);
  const settledRef = useRef(false);

  const reveal = () => {
    if (settledRef.current || !engagedRef.current) return;
    if (pendingEvtRef.current) {
      settledRef.current = true;
      setInstallEvt(pendingEvtRef.current);
      setMode("android");
      reportInstallEvent("pwa_install_prompt_shown", platformForMode("android"));
    } else if (pendingIosRef.current) {
      settledRef.current = true;
      const next = pendingIosRef.current;
      setMode((m) => (m === "hidden" ? next : m));
      reportInstallEvent("pwa_install_prompt_shown", platformForMode(next));
    }
  };

  useEffect(() => {
    if (typeof window === "undefined" || isStandalone() || dismissedThisSession() || hasExceededDeclines(PROMPT_ID)) return;
    let views = 1;
    try {
      views = Number(sessionStorage.getItem(VIEWS_KEY) ?? 0) + 1;
      sessionStorage.setItem(VIEWS_KEY, String(views));
    } catch {
      /* ignore */
    }
    if (views >= MIN_VIEWS) engagedRef.current = true;
    reveal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined" || isStandalone() || dismissedThisSession() || hasExceededDeclines(PROMPT_ID)) return;

    const onScroll = () => {
      if (window.scrollY >= SCROLL_PX) {
        engagedRef.current = true;
        window.removeEventListener("scroll", onScroll);
        reveal();
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    // Android/desktop: the browser tells us installation is available.
    const onPrompt = (e: Event) => {
      e.preventDefault();
      pendingEvtRef.current = e as BeforeInstallPromptEvent;
      reveal();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // The authoritative "actually installed" signal — fires on real success,
    // separate from (and sometimes without) the in-page Install button, e.g.
    // a user installing via Chrome's own address-bar icon instead of our
    // banner. iOS has no equivalent event (Apple gives web pages no visibility
    // into Home Screen adds at all), so this only ever fires on Chromium.
    const onInstalled = () => reportInstallEvent("pwa_installed", platformForMode("android"));
    window.addEventListener("appinstalled", onInstalled);

    // iOS: no event ever fires — detect and instruct.
    let t: ReturnType<typeof setTimeout> | null = null;
    if (isIosNeedingInstall()) {
      pendingIosRef.current = isIosInApp() ? "ios-inapp" : "ios";
      setBrowserName(iosBrowserLabel());
      t = setTimeout(reveal, 2500);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("scroll", onScroll);
      if (t) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    reportInstallEvent("pwa_install_dismissed", platformForMode(mode === "hidden" ? "android" : mode));
    setMode("hidden");
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    recordDecline(PROMPT_ID);
  };

  const install = async () => {
    if (!installEvt) return;
    setMode("hidden");
    try {
      await installEvt.prompt();
      const { outcome } = await installEvt.userChoice;
      if (outcome === "dismissed") {
        reportInstallEvent("pwa_install_dismissed", platformForMode("android"));
        sessionStorage.setItem(DISMISS_KEY, "1");
        recordDecline(PROMPT_ID);
      } else {
        reportInstallEvent("pwa_install_accepted", platformForMode("android"));
      }
    } catch {
      /* ignore */
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
                  {mode === "android"
                    ? "Add Frenz to your Home Screen"
                    : mode === "ios-inapp"
                      ? "Open in your browser to install"
                      : "Add Frenz to your Home Screen"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {mode === "android"
                    ? "A full-screen, app-like view with no browser bar, quicker access from your Home Screen, and faster downloads — plus notifications if you'd like them. You can turn notifications off anytime in Notification settings."
                    : mode === "ios-inapp"
                      ? "This link opened inside an app that can't install web apps. Copy the link below, open it in Safari, then add it to your Home Screen there for a full-screen, app-like view with no browser bar, quicker access, and faster downloads — with notifications if you'd like them (you can turn them off anytime in Notification settings)."
                      : `A full-screen, app-like view with no browser bar, quicker access from your Home Screen, and faster downloads — plus notifications if you'd like them (you can turn them off anytime in Notification settings). Nothing below is a button on this page — Apple requires every website to be added from ${browserName}'s own menu first. No site can skip this step.`}
                </p>
                {mode === "android" ? (
                  <button
                    type="button"
                    onClick={install}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95"
                  >
                    <Download className="h-4 w-4" /> Install app
                  </button>
                ) : mode === "ios-inapp" ? (
                  <button
                    type="button"
                    onClick={copyLink}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95"
                  >
                    <Copy className="h-4 w-4" /> {copied ? "Link copied" : "Copy link"}
                  </button>
                ) : (
                  <div className="mt-2.5">
                    <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-bold">1</span>
                      <span className="inline-flex items-center gap-1 text-foreground">
                        Tap <Share className="h-3.5 w-3.5 text-blue-500" /> Share in {browserName}
                      </span>
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-bold">2</span>
                      <span className="inline-flex items-center gap-1 text-foreground">
                        <SquarePlus className="h-3.5 w-3.5 text-violet-500" /> Add to Home Screen
                      </span>
                    </p>
                    <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 animate-bounce" aria-hidden />
                      That Share icon is in {browserName}&apos;s own toolbar around your screen&apos;s edge, not here.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
