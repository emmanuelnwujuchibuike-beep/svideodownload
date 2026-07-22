"use client";

import { Crown, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { getCompletedCount, onDownloadCompleted } from "@/features/downloads/manager";
import { getWatchCount, onVideoWatched } from "@/features/downloads/player-store";
import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";
import { useShowAds } from "./use-show-ads";

/**
 * The download-flow interstitial — the owner's three triggers on the download and
 * library surfaces:
 *
 *   1. 5 s of in-page idle,
 *   2. every 3rd completed download,
 *   3. every 3rd video watched from the download history.
 *
 * ── Who sees which ────────────────────────────────────────────────────────────
 * Idle and the download trigger are ad monetisation, so they only fire for
 * visitors who see ads at all (free + signed-out). The WATCH trigger is the one
 * exception the owner called out: a Pro user still sees it (but never Business,
 * who is fully ad-free). Business sees nothing here.
 *
 * ── No double interstitials ───────────────────────────────────────────────────
 * It shares the site interstitial's cooldown key, so on a page that also carries
 * the marketing IdleInterstitial (the library) the two coordinate — whichever
 * fires first holds the 60 s window. Pass `triggers` to drop the idle trigger
 * there, since that page already has one.
 *
 * ── Preloads, like the site interstitial ──────────────────────────────────────
 * The slot is mounted hidden from the start so the creative fetches in the
 * background; when a trigger fires the overlay reveals with no wait. The X is a
 * solid, high-contrast control present from the first frame.
 */

const IDLE_MS = 5_000;
const COOLDOWN_MS = 60_000;
const MIN_GAP_MS = 3_000;
const EVERY = 3;
/** Shared with the marketing IdleInterstitial so they never both fire. */
const LAST_SHOWN_KEY = "frenz:interstitial-last-shown";
const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

export type InterstitialTrigger = "idle" | "download" | "watch";

export function DownloadInterstitial({
  triggers = ["idle", "download", "watch"],
}: {
  triggers?: InterstitialTrigger[];
}) {
  const { showAds, ready } = useShowAds();
  const { plan } = useEntitlements();
  const [open, setOpen] = useState(false);
  const [hasAd, setHasAd] = useState<boolean | null>(null);
  const mountedAt = useRef(Date.now());

  // Business never sees an interstitial. Free/guest see all triggers; Pro sees
  // only the watch trigger (the owner's explicit exception).
  const watchAllowed = plan !== "business";
  const canPreload = ready && (showAds || (plan === "pro" && triggers.includes("watch")));

  const close = useCallback(() => setOpen(false), []);

  const show = useCallback(() => {
    if (open) return;
    if (Date.now() - mountedAt.current < MIN_GAP_MS) return;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(LAST_SHOWN_KEY)) || 0;
    } catch {
      last = Date.now(); // storage blocked → fail closed on the cooldown
    }
    if (Date.now() - last < COOLDOWN_MS) return;
    try {
      sessionStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
    } catch {
      /* in-memory `open` still prevents a double-fire this tick */
    }
    setOpen(true);
  }, [open]);

  // Idle + download triggers — ad visitors only (free / signed-out).
  useEffect(() => {
    if (!ready || !showAds) return;
    const offs: (() => void)[] = [];

    if (triggers.includes("idle")) {
      let timer: number | undefined;
      const arm = () => {
        window.clearTimeout(timer);
        if (document.visibilityState === "visible") timer = window.setTimeout(show, IDLE_MS);
      };
      for (const e of ACTIVITY) window.addEventListener(e, arm, { passive: true });
      arm();
      offs.push(() => {
        window.clearTimeout(timer);
        for (const e of ACTIVITY) window.removeEventListener(e, arm);
      });
    }

    if (triggers.includes("download")) {
      offs.push(onDownloadCompleted(() => {
        if (getCompletedCount() % EVERY === 0) show();
      }));
    }

    return () => offs.forEach((off) => off());
  }, [ready, showAds, triggers, show]);

  // Watch trigger — free/guest AND Pro (not Business).
  useEffect(() => {
    if (!ready || !watchAllowed || !triggers.includes("watch")) return;
    return onVideoWatched(() => {
      if (getWatchCount() % EVERY === 0) show();
    });
  }, [ready, watchAllowed, triggers, show]);

  const shown = open && hasAd === true;

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [shown, close]);

  if (!canPreload) return null;

  // The upsell line follows the plan: free/guest are asked to go Pro, a Pro user
  // is only ever asked to go Business (never "upgrade to Pro").
  const upsell =
    plan === "pro"
      ? { text: "Want an ad-free library?", cta: "Go Business", href: "/pricing" }
      : { text: "Tired of ads?", cta: "Upgrade to Pro", href: "/pricing" };

  return (
    <div
      className={cn(
        "fixed inset-0 z-[60] flex items-center justify-center p-4",
        shown ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      aria-hidden={!shown}
      role="dialog"
      aria-modal={shown}
      aria-label="Advertisement"
    >
      <button
        type="button"
        aria-label="Close advertisement"
        tabIndex={shown ? 0 : -1}
        onClick={close}
        className={cn("absolute inset-0 h-full w-full cursor-default bg-background/80 backdrop-blur-sm", !shown && "hidden")}
      />

      <div className={cn("relative w-full max-w-lg rounded-3xl border border-border/60 bg-card p-4 shadow-elevated", !shown && "hidden")}>
        <button
          type="button"
          onClick={close}
          tabIndex={shown ? 0 : -1}
          aria-label="Close advertisement"
          className="absolute -right-3 -top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-foreground text-background shadow-elevated ring-2 ring-background transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-5 w-5" strokeWidth={2.5} />
        </button>

        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">Sponsored</p>
        <AdSlot zone="idle_interstitial" dismissible={false} onResolved={setHasAd} />

        {/* Premium upsell — a Pro user never sees "upgrade to Pro". */}
        <Link
          href={upsell.href}
          onClick={close}
          className="group mt-3 flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 active:scale-[0.98]"
        >
          <Crown className="h-4 w-4" /> {upsell.text} <span className="underline decoration-white/40 underline-offset-2">{upsell.cta}</span>
        </Link>
      </div>
    </div>
  );
}
