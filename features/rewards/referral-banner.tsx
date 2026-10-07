"use client";

import { Gift, Share2, Sparkles, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { toast } from "@/features/ui/toast";
import { hasAuthCookie } from "@/lib/auth/has-auth-cookie";
import { haptic } from "@/lib/motion/haptics";
import { attributionLink, shareOrCopy } from "@/lib/referrals/share-client";

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
 *  · "Skip" unlocks after a short read (SKIP_AFTER_S); Escape and the backdrop
 *    do nothing until then. Reduced motion keeps the countdown, drops the motion.
 *  · Signed in → "Share my link" (their attribution link, one share helper).
 *    Guest → "Sign in to get your link": a guest has no account to credit.
 *  · Frenz AI glass (`ai-glass`), portalled to <body> (the fixed-overlay law).
 */
const SKIP_AFTER_S = 4;
const RULES_KEY = "frenz:rewards-public";

interface PublicRules {
  enabled: boolean;
  referralCredits: number;
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
  const [left, setLeft] = useState(SKIP_AFTER_S);
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
    if (!rules || left <= 0) return;
    const t = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [rules, left]);

  useEffect(() => {
    if (!rules) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && left <= 0) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rules, left, onClose]);

  if (!rules) return null;
  const canSkip = left <= 0;

  async function share() {
    if (busy) return;
    setBusy(true);
    haptic("selection");
    const url = (await attributionLink("app", "app")) ?? window.location.origin;
    const out = await shareOrCopy(url, "Join me on Frenzsave");
    if (out === "copied") toast("Your invite link is copied.", "success");
    else if (out === "failed") toast("Couldn't share the link.", "error");
    setBusy(false);
    if (out === "shared" || out === "copied") onClose();
  }

  const n = rules.referralCredits;
  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/55 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center" role="dialog" aria-modal="true" aria-labelledby="referral-banner-title" onClick={canSkip ? onClose : undefined}>
      <div className="referral-banner ai-glass relative w-full max-w-md overflow-hidden rounded-[1.75rem] p-5 text-slate-900 shadow-[0_30px_80px_-30px_rgba(49,46,129,0.6)] ring-1 ring-inset ring-white/70" onClick={(e) => e.stopPropagation()}>
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-gradient-to-br from-blue-500/30 via-indigo-500/25 to-violet-500/30 blur-2xl" />
        <button
          type="button"
          onClick={canSkip ? onClose : undefined}
          disabled={!canSkip}
          aria-label={canSkip ? "Skip" : `Skip in ${left} seconds`}
          className="absolute right-3 top-3 inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-full bg-white/70 px-2.5 text-[12px] font-semibold text-slate-600 ring-1 ring-inset ring-black/[0.06] transition disabled:cursor-default enabled:hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          {canSkip ? (
            <>
              Skip <X className="h-3.5 w-3.5" aria-hidden />
            </>
          ) : (
            <span className="tabular-nums" aria-live="polite">
              Skip in {left}
            </span>
          )}
        </button>

        <div className="relative">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-500 to-violet-500 text-white shadow-[0_10px_24px_-12px_rgba(79,70,229,0.9)]">
            <Gift className="h-5 w-5" aria-hidden />
          </span>
          <h2 id="referral-banner-title" className="mt-3 text-[21px] font-bold leading-tight tracking-[-0.02em]">
            Share Frenzsave, earn {n} credit{n === 1 ? "" : "s"}
          </h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-slate-600">
            Share your Frenzsave link. Each time someone you invite downloads, creates or subscribes, you earn {n} credit{n === 1 ? "" : "s"}.
          </p>

          <ul className="mt-4 space-y-2.5 text-[13.5px]">
            <li className="flex gap-2.5">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" aria-hidden />
              <span>Use your credits for Frenz AI video generation.</span>
            </li>
            <li className="flex gap-2.5">
              <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" aria-hidden />
              <span>
                Withdraw them once your account is {rules.qualification.minAccountAgeDays} days old with {rules.qualification.minEngagements} qualifying engagements and approved by our team.
              </span>
            </li>
            <li className="flex gap-2.5">
              <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" aria-hidden />
              <span>{signedIn ? "Rewards go to your account automatically." : "Sign in to get your link — rewards are credited to your account when your invite does something that counts."}</span>
            </li>
          </ul>

          {signedIn ? (
            <button
              type="button"
              onClick={() => void share()}
              disabled={busy}
              className="mt-5 inline-flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 text-[15px] font-semibold text-white shadow-[0_14px_30px_-14px_rgba(79,70,229,0.95)] transition active:scale-[0.99] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:active:scale-100"
            >
              <Share2 className="h-4 w-4" aria-hidden />
              {busy ? "Opening…" : "Share my link"}
            </button>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent("/rewards")}`}
              prefetch={false}
              onClick={onClose}
              className="mt-5 inline-flex min-h-[3rem] w-full items-center justify-center rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 text-[15px] font-semibold text-white shadow-[0_14px_30px_-14px_rgba(79,70,229,0.95)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              Sign in to get your link
            </Link>
          )}
          {signedIn ? (
            <Link href="/rewards" prefetch={false} onClick={onClose} className="mt-2 block text-center text-[13px] font-semibold text-indigo-700 hover:text-indigo-900">
              View rewards
            </Link>
          ) : null}
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
