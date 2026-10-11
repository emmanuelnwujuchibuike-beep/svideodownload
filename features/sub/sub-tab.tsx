"use client";

import { ArrowRight, Check, Copy, Lock, Pause, Pencil, Play, Plus, Share2, ShieldCheck, Wallet } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { GLASS, primaryPill, quietPill } from "@/features/friends/ui";
import { SubGallery, type SubQuoteView } from "@/features/sub/sub-gallery";
import { useSubEarnings } from "@/features/sub/sub-withdraw";
import { subscriptionCharge, usd } from "@/lib/creator/membership/engine";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

const SubComposer = dynamic(() => import("@/features/sub/sub-composer").then((m) => m.SubComposer), { ssr: false });
const SubPayoutSettings = dynamic(() => import("@/features/sub/payout-settings").then((m) => m.SubPayoutSettings), { ssr: false });
const SubWithdrawSheet = dynamic(() => import("@/features/sub/sub-withdraw").then((m) => m.SubWithdrawSheet), { ssr: false });

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
}

export interface SubBounds {
  minPriceCents: number;
  maxPriceCents: number;
  purchaseFeePercent: number;
  withdrawalFeePercent: number;
}

async function saveSettings(patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "settings", ...patch }) }).catch(() => null);
  const j = (await res?.json().catch(() => null)) as { error?: string } | null;
  return res?.ok ? { ok: true } : { ok: false, error: j?.error ?? "Couldn't save that. Try again." };
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
}: {
  creatorId: string;
  creatorName: string;
  handle: string;
  isOwner: boolean;
  signedIn: boolean;
  quote: SubQuoteView | null;
  settings: SubOwnerSettings | null;
  bounds: SubBounds;
}) {
  const [s, setS] = useState<SubOwnerSettings | null>(settings);
  const [composing, setComposing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [galleryKey, setGalleryKey] = useState(0);
  const loginNext = `/u/${handle}?tab=sub`;

  if (isOwner && s && !s.setupCompleted) {
    return <GetPaidSetup settings={s} bounds={bounds} onChange={setS} />;
  }

  return (
    <div>
      {isOwner && s ? (
        <>
          <ShareCard handle={handle} />
          <CreatorOverview settings={s} bounds={bounds} onChange={setS} onCompose={() => setComposing(true)} onWithdraw={() => setWithdrawing(true)} />
        </>
      ) : (
        <SubNotice />
      )}
      <SubGallery key={galleryKey} creatorId={creatorId} creatorName={creatorName} quote={isOwner ? null : quote} signedIn={signedIn} loginNext={loginNext} onCompose={isOwner ? () => setComposing(true) : undefined} />
      {composing ? <SubComposer onClose={() => setComposing(false)} onPosted={() => setGalleryKey((k) => k + 1)} /> : null}
      {withdrawing ? <SubWithdrawSheet onClose={() => setWithdrawing(false)} /> : null}
    </div>
  );
}

/** The prominent notice every visitor sees first: what this tab is and how it's protected. */
function SubNotice() {
  return (
    <div className="mb-3 flex items-start gap-3 rounded-[22px] border border-indigo-500/25 bg-indigo-500/[0.07] px-4 py-3.5">
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden />
      <div className="min-w-0">
        <p className="text-[14.5px] font-bold">SUB POSTS are for paid subscribers only</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">These posts are private to this creator&apos;s subscribers. They can&apos;t be shared, reposted, linked or downloaded, and they never appear in feeds or search.</p>
      </div>
    </div>
  );
}

/** "Get paid for your content" — four steps, saved as the creator goes. */
function GetPaidSetup({ settings, bounds, onChange }: { settings: SubOwnerSettings; bounds: SubBounds; onChange: (s: SubOwnerSettings) => void }) {
  const [step, setStep] = useState(Math.min(3, settings.setupStep));
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
  return (
    <div className={cn("rounded-[26px] p-4 sm:p-5", GLASS)}>
      <p className="text-[12px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Get paid for your content</p>
      <ol className="mt-2 flex gap-1.5" aria-label="Setup steps">
        {steps.map((label, i) => (
          <li key={label} className="flex-1" aria-current={i === step ? "step" : undefined}>
            <span className={cn("block h-1.5 rounded-full", i <= step ? "bg-gradient-to-r from-blue-600 to-violet-600" : "bg-black/[0.08] dark:bg-white/[0.1]")} />
            <span className={cn("mt-1 block text-[11px] font-semibold", i === step ? "text-foreground" : "text-muted-foreground")}>{label}</span>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="mt-4">
          <h3 className="text-[18px] font-extrabold tracking-[-0.01em]">What should a subscription cost?</h3>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            Subscribers get your SUB POSTS for 30 days. Choose from {usd(bounds.minPriceCents)} to {usd(bounds.maxPriceCents)}.
          </p>
          <label htmlFor="sub-price" className="mt-3 block text-[13px] font-semibold">
            Monthly price (USD)
          </label>
          <input id="sub-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, "").slice(0, 8))} placeholder="5.00" className="mt-1 w-full rounded-2xl border border-border bg-background px-3 py-2.5 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
          {charge ? (
            <p className="mt-2 text-[13px] text-muted-foreground">
              A subscriber pays {usd(charge.priceCents)} + {usd(charge.feeCents)} fee = <b className="text-foreground">{usd(charge.totalCents)}</b>. You earn <b className="text-foreground">{usd(charge.priceCents)}</b>.
            </p>
          ) : null}
          <button type="button" disabled={!priceOk} onClick={() => go(1, { priceCents: cents })} className={cn(primaryPill, "mt-4 w-full justify-center")}>
            Continue <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : step === 1 ? (
        <div className="mt-4">
          <h3 className="text-[18px] font-extrabold tracking-[-0.01em]">How you earn</h3>
          <ul className="mt-2 space-y-2 text-[13.5px]">
            <Point>People subscribe from your profile and pay through Paystack.</Point>
            <Point>You keep your full price. The subscriber pays a {bounds.purchaseFeePercent}% purchase fee on top.</Point>
            <Point>Your earnings go to a SUB balance of their own, separate from AI credits.</Point>
            <Point>Post photos and videos only subscribers can open. They stay private: no sharing, links, reposts or downloads.</Point>
          </ul>
          <Nav onBack={() => go(0)} onNext={() => go(2)} />
        </div>
      ) : step === 2 ? (
        <div className="mt-4">
          <h3 className="text-[18px] font-extrabold tracking-[-0.01em]">Getting paid</h3>
          <ul className="mt-2 space-y-2 text-[13.5px]">
            <Point>Withdraw your SUB balance to your bank through Paystack.</Point>
            <Point>Paystack checks the account holder&apos;s name before anything is sent.</Point>
            <Point>A {bounds.withdrawalFeePercent}% withdrawal fee applies. You see exactly what reaches your bank before you confirm.</Point>
            <Point>If a payment is refunded or disputed, that subscription ends and the amount comes back off your balance.</Point>
          </ul>
          <p className="mt-3 text-[12.5px] font-semibold text-muted-foreground">Optional: save your bank now and turn on auto-withdrawal, so every subscription goes straight to it.</p>
          <SubPayoutSettings feePercent={bounds.withdrawalFeePercent} className="mt-2" />
          <Nav onBack={() => go(1)} onNext={() => go(3)} />
        </div>
      ) : (
        <div className="mt-4">
          <h3 className="text-[18px] font-extrabold tracking-[-0.01em]">Ready to go live</h3>
          <p className="mt-1 text-[13.5px] text-muted-foreground">{charge ? `Your subscription is ${usd(charge.priceCents)} a month. ` : ""}Once live, the SUB POSTS tab on your profile shows your price and a Subscribe button. You can pause or change the price any time.</p>
          {!priceOk ? <p className="mt-2 text-[13px] font-medium text-rose-600">Go back and set your price first.</p> : null}
          <button type="button" disabled={!priceOk || busy} onClick={() => void finish()} className={cn(primaryPill, "mt-4 w-full justify-center bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600")}>
            {busy ? "Going live…" : "Go live"}
          </button>
          <button type="button" onClick={() => go(2)} className={cn(quietPill, "mt-2 w-full justify-center")}>
            Back
          </button>
        </div>
      )}
      {note ? <p className="mt-3 text-[13px] font-medium text-rose-600">{note}</p> : null}
    </div>
  );
}

function Point({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

function Nav({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="mt-4 flex gap-2">
      <button type="button" onClick={onBack} className={cn(quietPill, "flex-1 justify-center")}>
        Back
      </button>
      <button type="button" onClick={onNext} className={cn(primaryPill, "flex-1 justify-center")}>
        Continue <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/** "Your Content. Your Earnings." — sends people straight to this tab. */
function ShareCard({ handle }: { handle: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    haptic("selection");
    const url = `${window.location.origin}/u/${handle}?tab=sub`;
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
    <div className="mb-3 overflow-hidden rounded-[24px] bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 p-4 text-white">
      <p className="text-[19px] font-extrabold leading-tight tracking-[-0.01em]">Your Content. Your Earnings.</p>
      <p className="mt-1 text-[13px] text-white/85">Share your profile so people can subscribe to your SUB POSTS.</p>
      <button type="button" onClick={() => void share()} className="mt-3 inline-flex min-h-[2.75rem] items-center gap-2 rounded-full bg-white px-4 text-[14px] font-bold text-indigo-700 transition active:scale-[0.97]">
        {copied ? <Copy className="h-4 w-4" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />}
        {copied ? "Link copied" : "Share Profile & Get Paid"}
      </button>
    </div>
  );
}

function CreatorOverview({ settings, bounds, onChange, onCompose, onWithdraw }: { settings: SubOwnerSettings; bounds: SubBounds; onChange: (s: SubOwnerSettings) => void; onCompose: () => void; onWithdraw: () => void }) {
  const { data, failed } = useSubEarnings();
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(settings.priceCents ? (settings.priceCents / 100).toFixed(2) : "");
  const [note, setNote] = useState<string | null>(null);
  const e = data?.earnings;
  const cents = Math.round(Number(price) * 100);
  const priceOk = Number.isInteger(cents) && cents >= bounds.minPriceCents && cents <= bounds.maxPriceCents;

  const toggle = () => {
    haptic("selection");
    const prev = settings;
    onChange({ ...settings, active: !settings.active });
    void saveSettings({ active: !prev.active }).then((r) => {
      if (!r.ok) {
        onChange(prev);
        setNote(r.error ?? null);
      }
    });
  };
  const savePrice = () => {
    if (!priceOk) return;
    haptic("selection");
    const prev = settings;
    onChange({ ...settings, priceCents: cents });
    setEditing(false);
    void saveSettings({ priceCents: cents }).then((r) => {
      if (!r.ok) {
        onChange(prev);
        setNote(r.error ?? null);
      }
    });
  };

  return (
    <div className={cn("mb-3 rounded-[24px] p-4", GLASS)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[15px] font-bold">Your subscription</p>
        <span className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-semibold", settings.active ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/12 text-amber-700 dark:text-amber-300")}>{settings.active ? "Live" : "Paused"}</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Metric label="Price" value={settings.priceCents ? `${usd(settings.priceCents)}/mo` : "—"} />
        <Metric label="Subscribers" value={e ? String(e.activeSubscribers) : failed ? "—" : "…"} />
        <Metric label="Lifetime" value={e ? usd(e.lifetimeCents) : failed ? "—" : "…"} />
        <Metric label="Clearing" value={e ? usd(e.pendingCents) : failed ? "—" : "…"} />
        <Metric label="Available" value={e ? usd(e.availableCents) : failed ? "—" : "…"} strong />
        <Metric label="Withdrawn" value={e ? usd(e.withdrawnCents) : failed ? "—" : "…"} />
      </div>
      {editing ? (
        <div className="mt-3">
          <label htmlFor="sub-price-edit" className="text-[13px] font-semibold">
            New monthly price (USD) — applies to new subscriptions
          </label>
          <div className="mt-1 flex gap-2">
            <input id="sub-price-edit" inputMode="decimal" value={price} onChange={(ev) => setPrice(ev.target.value.replace(/[^0-9.]/g, "").slice(0, 8))} className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
            <button type="button" onClick={savePrice} disabled={!priceOk} className={cn(primaryPill, "shrink-0")}>
              Save
            </button>
          </div>
          {!priceOk && price ? <p className="mt-1 text-[12.5px] text-rose-600">Choose from {usd(bounds.minPriceCents)} to {usd(bounds.maxPriceCents)}.</p> : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onCompose} className={primaryPill}>
          <Plus className="h-4 w-4" aria-hidden /> New SUB post
        </button>
        <button type="button" onClick={onWithdraw} className={quietPill}>
          <Wallet className="h-4 w-4" aria-hidden /> Withdraw
        </button>
        <button type="button" onClick={() => setEditing((v) => !v)} aria-pressed={editing} className={quietPill}>
          <Pencil className="h-4 w-4" aria-hidden /> Price
        </button>
        <button type="button" onClick={toggle} className={quietPill}>
          {settings.active ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          {settings.active ? "Pause" : "Resume"}
        </button>
      </div>
      <SubPayoutSettings feePercent={bounds.withdrawalFeePercent} className="mt-3" />
      {!settings.active ? (
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden /> Paused: nobody new can subscribe. Current subscribers keep access until their period ends.
        </p>
      ) : null}
      {note ? <p className="mt-2 text-[13px] font-medium text-rose-600">{note}</p> : null}
    </div>
  );
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("truncate tabular-nums", strong ? "text-[17px] font-extrabold text-emerald-700 dark:text-emerald-400" : "text-[15px] font-bold")}>{value}</p>
    </div>
  );
}
