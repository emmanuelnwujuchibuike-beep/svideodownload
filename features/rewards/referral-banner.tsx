"use client";

import { Gift, Share2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { toast } from "@/features/ui/toast";
import { hasAuthCookie } from "@/lib/auth/has-auth-cookie";
import { haptic } from "@/lib/motion/haptics";
import { attributionLink, reportReferralShared, shareOrCopy } from "@/lib/referrals/share-client";
import { referralSentence, type ReferralAmounts } from "@/lib/rewards/referral-copy";

import { SNOOZE_KEY, snoozeUntil } from "./referral-daily";
import { markSharedToday } from "./referral-shared-today";

/**
 * The referral banner shown after a download (see referral-banner-trigger.tsx).
 *
 * Owner, 2026-10-07: "tell users to share the link to earn 2 credits, credit can
 * be used for AI video generation and to withdraw if your account has reached
 * its account age … can be skipped, but it must be a banner they will need to
 * read … sharing the link means they have to sign in to claim rewards if their
 * referral makes a valid activity."
 *
 *  · The amount and the thresholds are the operator's LIVE rules
 *    (/api/rewards/public, once per session) — "2" is never written here.
 *  · "Skip" works from the first frame — no countdown (owner, 2026-10-16: "make this section not
 *    to show timer count down, it should be skipable instantly"); Escape too. It only closes —
 *    it never snoozes, so the card returns on the next day's first download.
 *  · "I understood, don't show this again this week" is there from the first frame and
 *    snoozes the modal for 7 days (SNOOZE_KEY).
 *  · NOT intrusive (owner, 2026-10-15): a compact card docked at the bottom with no dimming
 *    backdrop — the page and the download's own progress stay visible and tappable.
 *    Reduced motion drops the motion.
 *  · Signed in → "Share my link" (their attribution link, one share helper).
 *    Guest → "Sign in to get your link": a guest has no account to credit.
 *  · Frenz AI glass (`ai-glass`), portalled to <body> (the fixed-overlay law).
 */
const RULES_KEY = "frenz:rewards-public";

interface PublicRules {
  enabled: boolean;
  referralCredits: number;
  /** Per event (2026-10-07): sign-up, top-up, subscribe — 0 when that event pays nothing. */
  referral?: ReferralAmounts;
  qualification: { minAccountAgeDays: number; minEngagements: number };
  withdrawals: { creditsPerUsd: number; minCredits: number } | null;
}

async function readRules(): Promise<PublicRules | null> {
  try {
    const hit = sessionStorage.getItem(RULES_KEY);
    if (hit) return JSON.parse(hit) as PublicRules;
  } catch {
    /* no session storage — ask the server */
  }
  try {
    const r = await fetch("/api/rewards/public");
    if (!r.ok) return null;
    const rules = (await r.json()) as PublicRules;
    try {
      sessionStorage.setItem(RULES_KEY, JSON.stringify(rules));
    } catch {
      /* fine */
    }
    return rules;
  } catch {
    return null;
  }
}

export function ReferralBanner({ onClose }: { onClose: () => void }) {
  const [rules, setRules] = useState<PublicRules | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSignedIn(hasAuthCookie());
    let live = true;
    void readRules().then((r) => {
      if (!live) return;
      // rewards switched off (or unreadable): there is nothing true to say — close quietly
      if (!r || !r.enabled || r.referralCredits <= 0) onClose();
      else setRules(r);
    });
    return () => {
      live = false;
    };
  }, [onClose]);

  useEffect(() => {
    if (!rules) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rules, onClose]);

  if (!rules) return null;

  async function share() {
    if (busy) return;
    setBusy(true);
    haptic("selection");
    const url = (await attributionLink("app", "app")) ?? window.location.origin;
    const out = await shareOrCopy(url, "Join me on Frenzsave");
    if (out === "copied" || out === "shared") reportReferralShared(out, "banner"); // owner 2026-10-09: admins are pushed
    if (out === "copied") toast("Your invite link is copied.", "success");
    else if (out === "failed") toast("Couldn't share the link.", "error");
    setBusy(false);
    if (out === "shared" || out === "copied") {
      markSharedToday();
      onClose();
    }
  }

  function understood() {
    try {
      localStorage.setItem(SNOOZE_KEY, String(snoozeUntil(new Date())));
    } catch {
      /* no storage — it may show again; nothing breaks */
    }
    onClose();
  }

  const n = rules.referralCredits;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[130] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" role="dialog" aria-modal="false" aria-labelledby="referral-banner-title">
      <div className="referral-banner ai-glass pointer-events-auto relative w-full max-w-md overflow-hidden rounded-[1.5rem] p-4 text-slate-900 shadow-[0_24px_60px_-28px_rgba(49,46,129,0.55)] ring-1 ring-inset ring-white/70">
        <button
          type="button"
          onClick={onClose}
          aria-label="Skip"
          // z-10: the content block below is `relative` and later in the DOM, so without a layer it
          // painted over this button and swallowed the tap (owner, 2026-10-08).
          className="absolute right-2.5 top-2.5 z-10 inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-full bg-white/70 px-2.5 text-[12px] font-semibold text-slate-600 ring-1 ring-inset ring-black/[0.06] transition disabled:cursor-default enabled:hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          Skip <X className="h-3.5 w-3.5" aria-hidden />
        </button>

        <div className="relative">
          <div className="flex items-center gap-2.5 pr-20">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 via-indigo-500 to-violet-500 text-white shadow-[0_8px_18px_-10px_rgba(79,70,229,0.9)]">
              <Gift className="h-[18px] w-[18px]" aria-hidden />
            </span>
            {/* owner, 2026-10-07: "Let the title and description be: earn credits with Frenzsave" */}
            <h2 id="referral-banner-title" className="text-[17px] font-bold leading-tight tracking-[-0.02em]">
              Earn credits with Frenzsave
            </h2>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-600">{referralSentence(rules, n)}</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
            {signedIn
              /* owner, 2026-10-30: credits are for Frenz AI; cashing out is for approved affiliates, through support */
              ? "Use your credits for Frenz AI. Rewards go to your account automatically. Want to cash out? Approved affiliates can — contact support to join."
              : "Use your credits for Frenz AI. Sign in to get your link."}
          </p>

          {signedIn ? (
            <button
              type="button"
              onClick={() => void share()}
              disabled={busy}
              className="mt-3 inline-flex min-h-[2.75rem] w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 text-[14px] font-semibold text-white shadow-[0_12px_26px_-14px_rgba(79,70,229,0.95)] transition active:scale-[0.99] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:active:scale-100"
            >
              <Share2 className="h-4 w-4" aria-hidden />
              {busy ? "Opening…" : "Share my link"}
            </button>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent("/rewards")}`}
              prefetch={false}
              onClick={onClose}
              className="mt-3 inline-flex min-h-[2.75rem] w-full items-center justify-center rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 text-[14px] font-semibold text-white shadow-[0_12px_26px_-14px_rgba(79,70,229,0.95)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              Sign in to get your link
            </Link>
          )}
          <button type="button" onClick={understood} className="mt-1.5 block min-h-[2.25rem] w-full text-center text-[12.5px] font-semibold text-indigo-700 hover:text-indigo-900">
            I understood, don&apos;t show this again this week
          </button>
        </div>
      </div>
      <style>{`
        .referral-banner{animation:referral-banner-in .34s cubic-bezier(.2,.9,.3,1.1) both}
        @keyframes referral-banner-in{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}
        @media (prefers-reduced-motion: reduce){.referral-banner{animation:none}}
        :root[data-a11y-motion="reduce"] .referral-banner{animation:none}
      `}</style>
    </div>,
    document.body,
  );
}
