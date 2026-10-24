"use client";

import { ArrowRight, BadgeCheck, BarChart3, Bell, BadgeDollarSign, Check, ChevronDown, Landmark, Loader2, Lock, Percent, Plus, Receipt, Rocket, Undo2, Users, Wallet, type LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";

import { BellIcon, ChevronRightIcon, LinkIcon, MegaphoneIcon } from "@/features/frenz-ui/icons";
import { SubGallery, type SubQuoteView } from "@/features/sub/sub-gallery";
import { forgetSubPosts } from "@/features/sub/sub-posts-cache";
import { EX_CARD, EX_WELL, exPrimary, exQuiet } from "@/features/sub/ui";
import { subscriptionCharge, usd } from "@/lib/creator/membership/engine";
import { haptic } from "@/lib/motion/haptics";
import type { BundlePrices } from "@/lib/sub/pricing";
import { cn } from "@/lib/utils";
import { profilePath } from "@/lib/social/profile-url";
import { saveSubSettings as saveSettings } from "@/features/sub/sub-settings-client";

const SubComposer = dynamic(() => import("@/features/sub/sub-composer").then((m) => m.SubComposer), { ssr: false });
const SubPayoutSettings = dynamic(() => import("@/features/sub/payout-settings").then((m) => m.SubPayoutSettings), { ssr: false });
// Part 6: loaded only where they show (the owner's studio, a signed-in visitor), never in first paint
const CreatorAnnouncements = dynamic(() => import("@/features/sub/announcements").then((m) => m.CreatorAnnouncements), { ssr: false });
const SubscriberAnnouncements = dynamic(() => import("@/features/sub/announcements").then((m) => m.SubscriberAnnouncements), { ssr: false });
const CreatorNotifySettings = dynamic(() => import("@/features/sub/creator-notify-settings").then((m) => m.CreatorNotifySettings), { ssr: false });
const ExclusiveAlerts = dynamic(() => import("@/features/sub/exclusive-alerts").then((m) => m.ExclusiveAlerts), { ssr: false });

/**
 * The SUB POSTS tab on a profile (owner briefs 2026-10-11).
 *
 *   · A visitor sees a clear notice of what this tab is, the price with its fee
 *     spelled out, and the subscriber-only gallery (locked until they pay).
 *   · The creator, before they've set up: "Get paid for your content" — four
 *     short steps (price, how earning works, how payouts work, go live). The
 *     step is saved as they go, so leaving and coming back resumes.
 *   · The creator, once live: "Your Content. Your Earnings." — a share card that
 *     sends people to this tab, a real overview (price, active subscribers,
 *     lifetime, clearing, available — every number from the server, none
 *     invented), and the actions: post, withdraw, change the price, pause.
 */

export interface SubOwnerSettings {
  priceCents: number | null;
  active: boolean;
  setupStep: number;
  setupCompleted: boolean;
  /** Part 6 (0251): how the creator hears about a new subscriber */
  notifySubscribed?: "off" | "push" | "email" | "both";
  /** 0277: the 3 / 6 / 12-month bundle totals (null = off) */
  bundlePrices?: BundlePrices;
  /** 0277 has run: bundles and promotions can be saved */
  bundlesReady?: boolean;
}

export interface SubBounds {
  minPriceCents: number;
  maxPriceCents: number;
  purchaseFeePercent: number;
  withdrawalFeePercent: number;
}


export function SubTab({
  creatorId,
  creatorName,
  handle,
  isOwner,
  signedIn,
  quote,
  settings,
  bounds,
  onLiveChange,
}: {
  /** tells the profile's "Get paid" card when setup has gone live (or been paused) */
  onLiveChange?: (live: boolean) => void;
  creatorId: string;
  creatorName: string;
  handle: string;
  isOwner: boolean;
  signedIn: boolean;
  quote: SubQuoteView | null;
  settings: SubOwnerSettings | null;
  bounds: SubBounds;
}) {
  const [s, setSRaw] = useState<SubOwnerSettings | null>(settings);
  const setS = (next: SubOwnerSettings) => {
    setSRaw(next);
    onLiveChange?.(next.setupCompleted);
  };
  const [composing, setComposing] = useState(false);
  const [galleryKey, setGalleryKey] = useState(0);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const loginNext = `${profilePath(handle)}?tab=sub`;

  if (isOwner && s && !s.setupCompleted) {
    return <GetPaidSetup settings={s} bounds={bounds} onChange={setS} />;
  }

  return (
    <div>
      {isOwner && s ? (
        <>
          {/*
            ONE dashboard card (ProfileExclusive.dc.html, 2026-10-18): price and LIVE status, the real
            subscribers / last-30-days / posts figures, New exclusive post, Share link (the banner's old job)
            and Dashboard, then Announcements and Subscriber notifications as rows — each opening the same
            panel the two dropdowns opened.
          */}
          <CreatorOverview
            handle={handle}
            settings={s}
            bounds={bounds}
            onChange={setS}
            onCompose={() => setComposing(true)}
            announceOpen={announceOpen}
            notifyOpen={notifyOpen}
            onAnnounce={() => {
              haptic("selection");
              setAnnounceOpen((o) => !o);
            }}
            onNotify={() => {
              haptic("selection");
              setNotifyOpen((o) => !o);
            }}
          />
          <div id="sub-notify-panel" hidden={!notifyOpen}>
            <CreatorNotifySettings initial={s.notifySubscribed ?? "both"} />
          </div>
          <div id="sub-announce-panel" hidden={!announceOpen}>
            <CreatorAnnouncements creatorId={creatorId} />
          </div>
        </>
      ) : null}
      {!isOwner && signedIn ? (
        <>
          {/* Owner 2026-10-17: the "Stay close" controls live behind a Notifications button. The card stays
              mounted (hidden) so its settings are already loaded: the tap only shows it, at once. */}
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              aria-expanded={alertsOpen}
              aria-controls="sub-alerts-panel"
              onClick={() => {
                haptic("selection");
                setAlertsOpen((o) => !o);
              }}
              className={cn("ex-btn ex-btn--glass ex-btn--sm touch-manipulation", alertsOpen && "text-primary")}
            >
              <Bell className="h-4 w-4" aria-hidden /> Notifications
              <ChevronDown className={cn("h-4 w-4 transition-transform duration-150 motion-reduce:transition-none", alertsOpen && "rotate-180")} aria-hidden />
            </button>
          </div>
          <div id="sub-alerts-panel" hidden={!alertsOpen}>
            <ExclusiveAlerts creatorId={creatorId} creatorName={creatorName} />
          </div>
          <SubscriberAnnouncements creatorId={creatorId} />
        </>
      ) : null}
      <SubGallery key={galleryKey} creatorId={creatorId} creatorName={creatorName} quote={isOwner ? null : quote} signedIn={signedIn} loginNext={loginNext} />
      {composing ? <SubComposer onClose={() => setComposing(false)} onPosted={() => {
            forgetSubPosts(creatorId);
            setGalleryKey((k) => k + 1);
          }} /> : null}
    </div>
  );
}

/** The prominent notice every visitor sees first: what this tab is and how it's protected. */
/**
 * "Get paid for your content" — four steps, saved as the creator goes.
 *
 * Owner, 2026-10-16: "upgrade this card to look extremely charming, glass, fast in animation when
 * selecting … not a simple block card, cause that's the gateway for users who haven't used it."
 * A glass stage over a static aurora; numbered step dots that fill and lift; the price as the
 * centrepiece with quick picks on a sliding segmented thumb; what the creator earns and what a
 * subscriber pays, live; each step slides in. Every motion is a one-shot transform/opacity on
 * interaction (none loops), reduced motion drops it, and every number comes from the engine the
 * server settles with.
 */
function GetPaidSetup({ settings, bounds, onChange }: { settings: SubOwnerSettings; bounds: SubBounds; onChange: (s: SubOwnerSettings) => void }) {
  const [step, setStep] = useState(Math.min(3, settings.setupStep));
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [price, setPrice] = useState(settings.priceCents ? (settings.priceCents / 100).toFixed(2) : "");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cents = Math.round(Number(price) * 100);
  const priceOk = Number.isInteger(cents) && cents >= bounds.minPriceCents && cents <= bounds.maxPriceCents;
  const charge = priceOk ? subscriptionCharge(cents, bounds.purchaseFeePercent) : null;

  // instant on tap: the step moves now, the save follows
  const go = (next: number, patch: Record<string, unknown> = {}) => {
    haptic("selection");
    setNote(null);
    setDir(next > step ? "fwd" : "back");
    setStep(next);
    onChange({ ...settings, setupStep: next, ...(patch.priceCents ? { priceCents: patch.priceCents as number } : {}) });
    void saveSettings({ step: next, ...patch }).then((r) => {
      if (!r.ok) {
        setStep(step);
        setNote(r.error ?? null);
      }
    });
  };

  const finish = async () => {
    haptic("selection");
    setBusy(true);
    const r = await saveSettings({ priceCents: cents, complete: true });
    setBusy(false);
    if (r.ok) onChange({ ...settings, priceCents: cents, setupStep: 4, setupCompleted: true, active: true });
    else setNote(r.error ?? null);
  };

  const steps = ["Your price", "How you earn", "Getting paid", "Go live"];
  // quick picks inside the admin's bounds — a tap fills the field, the field stays the authority
  const picks = [300, 500, 1000, 2000].filter((c) => c >= bounds.minPriceCents && c <= bounds.maxPriceCents);
  const picked = picks.indexOf(cents);
  const typed = price !== "" && !priceOk;
  const enter = cn("animate-in fade-in duration-200 motion-reduce:animate-none", dir === "fwd" ? "slide-in-from-right-3" : "slide-in-from-left-3");

  return (
    <section aria-labelledby="get-paid-title" className={cn("overflow-hidden", EX_CARD)}>
      <div aria-hidden className="ex-aurora" />
      <div className="relative px-5 pb-5 pt-5">
        {/* the hero */}
        <div className="flex items-center gap-3">
          <span aria-hidden className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-500 to-violet-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_22px_-10px_rgba(79,70,229,0.85)]">
            <BadgeDollarSign className="h-[22px] w-[22px]" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-primary">Frenz Exclusive</p>
            <h2 id="get-paid-title" className="text-[19px] font-bold leading-tight tracking-[-0.02em]">
              Get paid for your content
            </h2>
          </div>
        </div>

        {/* the step rail: dots that fill, a track that fills between them */}
        <ol className="mt-5 flex items-center" aria-label={`Setup, step ${step + 1} of ${steps.length}: ${steps[step]}`}>
          {steps.map((label, i) => (
            <li key={label} className={cn("flex items-center", i < steps.length - 1 && "flex-1")} aria-current={i === step ? "step" : undefined}>
              <span className="ex-dot" data-state={i < step ? "done" : i === step ? "current" : "next"} title={label}>
                {i < step ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : i + 1}
                <span className="sr-only">{label}</span>
              </span>
              {i < steps.length - 1 ? <span className="ex-steps__bar mx-1.5 flex-1" data-done={i < step} aria-hidden /> : null}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[12px] font-semibold text-muted-foreground" aria-hidden>
          Step {step + 1} of {steps.length} · <span className="text-foreground">{steps[step]}</span>
        </p>

        <div key={step} className={cn("mt-4", enter)}>
          {step === 0 ? (
            <>
              <h3 className="text-[17px] font-bold tracking-[-0.015em]">What should a subscription cost?</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">Subscribers unlock your private posts for 30 days.</p>

              {/* the price is the centrepiece */}
              <label htmlFor="sub-price" className="ex-pricepad mt-4 block cursor-text text-center" data-invalid={typed || undefined}>
                <span className="block text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Monthly price</span>
                <span className="mt-1 flex items-baseline justify-center gap-1">
                  <span aria-hidden className="text-[26px] font-bold text-muted-foreground">
                    $
                  </span>
                  <input
                    id="sub-price"
                    inputMode="decimal"
                    autoComplete="off"
                    value={price}
                    style={{ width: `${Math.max(4, (price || "5.00").length) + 0.2}ch` }}
                    data-large-text=""
                    onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, "").slice(0, 8))}
                    placeholder="5.00"
                    aria-invalid={typed}
                    aria-describedby="sub-price-hint"
                    className="min-w-0 bg-transparent text-center text-[40px] font-bold leading-none tracking-[-0.03em] tabular-nums outline-none placeholder:text-muted-foreground/40"
                  />
                  <span aria-hidden className="text-[14px] font-semibold text-muted-foreground">
                    / month
                  </span>
                </span>
              </label>

              {picks.length ? (
                <div role="radiogroup" aria-label="Suggested prices" className="ex-seg ex-seg--fast ex-glass mt-3">
                  {picked >= 0 ? <span aria-hidden className="ex-seg__thumb" style={{ width: `calc((100% - 0.5rem) / ${picks.length})`, transform: `translateX(${picked * 100}%)` }} /> : null}
                  {picks.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={cents === c}
                      className="ex-seg__opt tabular-nums"
                      onClick={() => {
                        haptic("selection");
                        setPrice((c / 100).toFixed(2));
                      }}
                    >
                      {usd(c)}
                    </button>
                  ))}
                </div>
              ) : null}

              {/* what it means, live */}
              <div className="mt-3 grid grid-cols-2 gap-2" aria-hidden={!charge}>
                <div className={cn(EX_WELL, "px-3.5 py-2.5")}>
                  <p className="text-[11.5px] font-medium text-muted-foreground">You earn</p>
                  <p className="mt-0.5 text-[17px] font-bold tabular-nums tracking-[-0.01em]">{charge ? usd(charge.priceCents) : "—"}</p>
                </div>
                <div className={cn(EX_WELL, "px-3.5 py-2.5")}>
                  <p className="text-[11.5px] font-medium text-muted-foreground">Subscribers pay</p>
                  <p className="mt-0.5 text-[17px] font-bold tabular-nums tracking-[-0.01em]">{charge ? usd(charge.totalCents) : "—"}</p>
                </div>
              </div>
              <p id="sub-price-hint" aria-live="polite" className={cn("mt-2.5 min-h-[1.25rem] text-[12.5px]", typed ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
                {typed
                  ? `Choose from ${usd(bounds.minPriceCents)} to ${usd(bounds.maxPriceCents)}.`
                  : charge
                    ? `Subscribers pay your price plus a ${bounds.purchaseFeePercent}% purchase fee. You keep your full price.`
                    : `Anything from ${usd(bounds.minPriceCents)} to ${usd(bounds.maxPriceCents)}. You can change it any time.`}
              </p>
              <button type="button" disabled={!priceOk} onClick={() => go(1, { priceCents: cents })} className={cn(exPrimary, "mt-3 w-full")}>
                Continue <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            </>
          ) : step === 1 ? (
            <>
              <h3 className="text-[17px] font-bold tracking-[-0.015em]">How you earn</h3>
              <ul className="mt-3 space-y-3">
                <Feature icon={Users} title="Subscribers unlock you" body="People subscribe from your profile and pay through Paystack." />
                <Feature icon={Percent} title="You keep your full price" body={`The subscriber pays a ${bounds.purchaseFeePercent}% purchase fee on top.`} />
                <Feature icon={Wallet} title="A balance of its own" body="Your earnings go to a private post balance, separate from AI credits." />
                <Feature icon={Lock} title="Private by design" body="Photos and videos only subscribers can open: no sharing, links, reposts or downloads." />
              </ul>
              <Nav onBack={() => go(0)} onNext={() => go(2)} />
            </>
          ) : step === 2 ? (
            <>
              <h3 className="text-[17px] font-bold tracking-[-0.015em]">Getting paid</h3>
              <ul className="mt-3 space-y-3">
                <Feature icon={Landmark} title="Straight to your bank" body="Withdraw your private post balance through Paystack or Flutterwave." />
                <Feature icon={BadgeCheck} title="Name-checked first" body="Paystack confirms the account holder's name before anything is sent." />
                <Feature icon={Receipt} title="No surprises" body={`A ${bounds.withdrawalFeePercent}% withdrawal fee applies. You see exactly what reaches your bank before you confirm.`} />
                <Feature icon={Undo2} title="Refunds are fair" body="If a payment is refunded or disputed, that subscription ends and the amount comes off your balance." />
              </ul>
              <p className="mt-4 text-[12.5px] font-medium text-muted-foreground">Optional: save your bank now and turn on auto-withdrawal, so every subscription goes straight to it.</p>
              <SubPayoutSettings feePercent={bounds.withdrawalFeePercent} className="mt-2" />
              <Nav onBack={() => go(1)} onNext={() => go(3)} />
            </>
          ) : (
            <>
              <h3 className="text-[17px] font-bold tracking-[-0.015em]">Ready to go live</h3>
              {charge ? (
                <div className="ex-pricepad mt-3 text-center">
                  <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Your subscription</p>
                  <p className="mt-1 text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums">
                    {usd(charge.priceCents)}
                    <span className="ml-1 text-[14px] font-semibold tracking-normal text-muted-foreground">/ month</span>
                  </p>
                  <p className="mt-1.5 text-[12.5px] text-muted-foreground">Subscribers pay {usd(charge.totalCents)} with the purchase fee</p>
                </div>
              ) : (
                <p className="mt-2 text-[13px] font-medium text-rose-600 dark:text-rose-400">Go back and set your price first.</p>
              )}
              <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">Once live, the PRIVATE POSTS tab on your profile shows your price and a Subscribe button. You can pause or change the price any time.</p>
              <button type="button" disabled={!priceOk || busy} onClick={() => void finish()} className={cn(exPrimary, "mt-4 w-full")}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Rocket className="h-4 w-4" aria-hidden />}
                {busy ? "Going live…" : "Go live"}
              </button>
              <button type="button" onClick={() => go(2)} className={cn(exQuiet, "mt-2 w-full")}>
                Back
              </button>
            </>
          )}
        </div>
        {note ? <p role="alert" className="mt-3 text-[13px] font-medium text-rose-600 dark:text-rose-400">{note}</p> : null}
      </div>
    </section>
  );
}

/** One fact on a setup step: a tinted icon, a short title, the detail. */
function Feature({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/15 to-violet-500/15 text-primary ring-1 ring-inset ring-primary/10 dark:from-blue-400/20 dark:to-violet-400/20">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold leading-snug">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">{body}</span>
      </span>
    </li>
  );
}

function Nav({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="mt-5 flex gap-2">
      <button type="button" onClick={onBack} className={cn(exQuiet, "flex-1")}>
        Back
      </button>
      <button type="button" onClick={onNext} className={cn(exPrimary, "flex-[2]")}>
        Continue <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/** "Your Content. Your Earnings." — sends people straight to this tab. */
/**
 * The creator's SUB dashboard (owner 2026-10-12: "collapse on default when the SUB POSTS tab is
 * clicked, and the user clicks See dashboard and it opens"). Collapsed it is one calm row —
 * live or paused, the price, New SUB post and See dashboard — and the earnings are not even
 * fetched until it opens. Since step 20 (2026-10-19) the full dashboard — balance, Withdraw, price, pause and
 * the payout account — is its own page, /exclusive/dashboard (features/sub/subs-dashboard.tsx).
 */
function CreatorOverview({
  handle,
  settings,
  onCompose,
  announceOpen,
  notifyOpen,
  onAnnounce,
  onNotify,
}: {
  handle: string;
  settings: SubOwnerSettings;
  bounds: SubBounds;
  onChange: (s: SubOwnerSettings) => void;
  onCompose: () => void;
  announceOpen: boolean;
  notifyOpen: boolean;
  onAnnounce: () => void;
  onNotify: () => void;
}) {
  // the card's three figures — the creator's own, from the same overview the earnings page reads; "—" until in
  const overview = useSubOverview();
  const [copied, setCopied] = useState(false);
  // what the old "Your Content. Your Earnings." banner did: share the subscribe link
  const shareLink = async () => {
    haptic("selection");
    const url = `${window.location.origin}${profilePath(handle)}?tab=sub`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Subscribe to my content on Frenz", url });
        return;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard refused: nothing to do */
    }
  };
  return (
    <section aria-label="Subscription dashboard" className="frenz-ui mb-4 overflow-hidden rounded-[24px] border border-frenz-line bg-frenz-card text-frenz-ink shadow-frenz-raised">
      <div className="flex flex-col gap-3.5 p-4 pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[13px] font-bold text-frenz-muted">Your subscription</span>
            <span className="font-heading text-[30px] font-extrabold leading-none tracking-[-1px] tabular-nums">
              {settings.priceCents ? usd(settings.priceCents) : "No price"}
              {settings.priceCents ? <span className="font-body text-[15px] font-semibold tracking-normal text-frenz-muted"> / month</span> : null}
            </span>
          </div>
          <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold tracking-[0.4px]", settings.active ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
            <span aria-hidden className={cn("h-[7px] w-[7px] rounded-full", settings.active ? "bg-emerald-500" : "bg-amber-500")} />
            {settings.active ? "LIVE" : "PAUSED"}
          </span>
        </div>

        <div className="grid grid-cols-3 rounded-2xl bg-frenz-fill py-3">
          <CardStat label="Subscribers" value={overview ? String(overview.activeSubscribers) : "—"} />
          <CardStat label="Last 30 days" value={overview?.netCents !== undefined && overview.netCents !== null ? usd(overview.netCents) : "—"} divided />
          <CardStat label="Posts" value={overview ? String(overview.posts) : "—"} divided />
        </div>

        {/* the one primary action here — the brand gradient is allowed on it */}
        <button type="button" onClick={onCompose} className="flex h-[52px] items-center justify-center gap-2 rounded-2xl bg-frenz-gradient-x font-heading text-base font-bold text-white transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet focus-visible:ring-offset-2">
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.6} aria-hidden /> New exclusive post
        </button>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" onClick={() => void shareLink()} className="flex h-[46px] items-center justify-center gap-2 rounded-[14px] border border-frenz-line bg-frenz-card text-sm font-bold transition active:scale-[0.98]">
            {copied ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : <LinkIcon size={16} />}
            {copied ? "Link copied" : "Share link"}
          </button>
          {/* step 20 (2026-10-19): the full Subscriptions dashboard is its own page (design/SubsDashboard.dc.html) */}
          <Link href="/exclusive/dashboard" className="flex h-[46px] items-center justify-center gap-2 rounded-[14px] border border-frenz-line bg-frenz-card text-sm font-bold text-frenz-ink no-underline transition active:scale-[0.98]">
            <BarChart3 className="h-4 w-4" aria-hidden /> Dashboard
          </Link>
        </div>
      </div>

      {/* the two dropdowns, now rows (owner, 2026-10-18) — each opens its panel under the card */}
      <div className="mt-3.5 border-t border-frenz-line">
        <CardRow icon={<MegaphoneIcon size={18} />} label="Announce to subscribers" expanded={announceOpen} controls="sub-announce-panel" onClick={onAnnounce} />
        <CardRow icon={<BellIcon size={18} />} label="Subscriber notifications" expanded={notifyOpen} controls="sub-notify-panel" onClick={onNotify} divided />
      </div>

      {!settings.active ? (
        <p className="flex items-center gap-1.5 px-4 pb-3 text-[12.5px] text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden /> Paused: nobody new can subscribe. Current subscribers keep access until their period ends.
        </p>
      ) : null}
    </section>
  );
}

/** One of the card's three figures. */
function CardStat({ label, value, divided = false }: { label: string; value: string; divided?: boolean }) {
  return (
    <span className={cn("flex min-w-0 flex-col items-center gap-0.5 px-1", divided && "border-l border-frenz-line")}>
      <span className="max-w-full truncate font-heading text-lg font-bold tabular-nums">{value}</span>
      <span className="text-xs font-semibold text-frenz-muted">{label}</span>
    </span>
  );
}

/** A row under the card that opens a panel below it. */
function CardRow({ icon, label, expanded, controls, onClick, divided = false }: { icon: React.ReactNode; label: string; expanded: boolean; controls: string; onClick: () => void; divided?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={controls}
      className={cn("flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] font-semibold transition hover:bg-frenz-fill", divided && "border-t border-frenz-line")}
    >
      <span aria-hidden className="flex text-frenz-violet">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRightIcon size={15} strokeWidth={2.4} className={cn("shrink-0 text-frenz-muted transition-transform duration-150", expanded && "rotate-90")} />
    </button>
  );
}

/**
 * The creator's own overview for the card's figures: active subscribers, what the last 30 days added
 * (earned − clawed back) and the posts published — one read of the same endpoint the earnings page uses,
 * when the owner opens the tab. Null until in, and on any failure: the card then shows "—", never a guess.
 */
function useSubOverview(): { activeSubscribers: number; netCents: number | null; posts: number } | null {
  const [v, setV] = useState<{ activeSubscribers: number; netCents: number | null; posts: number } | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch("/api/sub/earnings/overview?days=30")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { activeSubscribers?: number; period?: { netCents?: number } | null; posts?: { published?: number } } | null) => {
        if (!alive || !j) return;
        setV({ activeSubscribers: Number(j.activeSubscribers ?? 0), netCents: j.period ? Number(j.period.netCents ?? 0) : null, posts: Number(j.posts?.published ?? 0) });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return v;
}

