"use client";

import { BadgePercent, BarChart3, Bell, Check, ChevronLeft, CirclePause, Loader2, Megaphone, Tag, Wallet } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { ChevronRightIcon } from "@/features/frenz-ui/icons";
import type { SubBounds, SubOwnerSettings } from "@/features/sub/sub-tab";
import { saveSubSettings } from "@/features/sub/sub-settings-client";
import { useSubEarnings } from "@/features/sub/sub-withdraw";
import { usd } from "@/lib/creator/membership/engine";
import { haptic } from "@/lib/motion/haptics";
import { profilePath } from "@/lib/social/profile-url";
import { cn } from "@/lib/utils";

const SubPayoutSettings = dynamic(() => import("@/features/sub/payout-settings").then((m) => m.SubPayoutSettings), { ssr: false });
const CreatorAnnouncements = dynamic(() => import("@/features/sub/announcements").then((m) => m.CreatorAnnouncements), { ssr: false });
const CreatorNotifySettings = dynamic(() => import("@/features/sub/creator-notify-settings").then((m) => m.CreatorNotifySettings), { ssr: false });
const SubWithdrawSheet = dynamic(() => import("@/features/sub/sub-withdraw").then((m) => m.SubWithdrawSheet), { ssr: false });
// 0277: bundles and promotions — loaded only when their panel opens
const SubBundleEditor = dynamic(() => import("@/features/sub/sub-bundle-editor").then((m) => m.SubBundleEditor), { ssr: false });
const SubPromotions = dynamic(() => import("@/features/sub/sub-promotions").then((m) => m.SubPromotions), { ssr: false });
const NO_BUNDLES = { 3: null, 6: null, 12: null } as const;

/**
 * The Subscriptions dashboard (step 20, design/SubsDashboard.dc.html, owner 2026-10-19).
 *
 *   ‹ Profile · LIVE · "Subscriptions" · n subscribers · price / month
 *   Available to withdraw + Withdraw · Earned all time · Clearing · Withdrawn
 *   Earnings & analytics ›
 *   Subscription: Price · Pause new subscribers (switch) · Announce to subscribers · Subscriber notifications
 *   Payout: the bank · Auto-withdrawal (switch) · Remove payout account
 *
 * Every figure is the server's (`/api/sub/earnings`, the same read the old inline dashboard made) — "—" until
 * in, never a guess. Every control is the one the profile's Exclusive card already had: the same price save,
 * pause, withdraw sheet, announcements, notification setting and payout account.
 */
export function SubsDashboard({ creatorId, handle, settings: initial, bounds }: { creatorId: string; handle: string; settings: SubOwnerSettings; bounds: SubBounds }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const { data, failed, reload } = useSubEarnings(true);
  const e = data?.earnings;
  const [withdrawing, setWithdrawing] = useState(false);
  const [panel, setPanel] = useState<"price" | "promotions" | "announce" | "notify" | null>(null);
  const [price, setPrice] = useState(settings.priceCents ? (settings.priceCents / 100).toFixed(2) : "");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const cents = Math.round(Number(price) * 100);
  const priceOk = Number.isInteger(cents) && cents >= bounds.minPriceCents && cents <= bounds.maxPriceCents;
  const money = (v: number | undefined) => (v !== undefined ? usd(v) : failed ? "—" : "…");

  const open = (p: "price" | "promotions" | "announce" | "notify") => {
    haptic("selection");
    setPanel((cur) => (cur === p ? null : p));
  };

  // answers on the tap; goes back if the server refuses (the card's own rule, unchanged)
  const togglePause = () => {
    haptic("selection");
    const prev = settings;
    setSettings({ ...settings, active: !settings.active });
    void saveSubSettings({ active: !prev.active }).then((r) => {
      if (!r.ok) {
        setSettings(prev);
        setNote({ ok: false, text: r.error ?? "Couldn't save that." });
      } else router.refresh();
    });
  };

  const savePrice = async () => {
    if (!priceOk || saving) return;
    haptic("selection");
    setNote(null);
    setSaving(true);
    const r = await saveSubSettings({ priceCents: cents });
    setSaving(false);
    if (!r.ok) {
      setNote({ ok: false, text: r.error ?? "Couldn't save the price. Try again." });
      return;
    }
    setSettings({ ...settings, priceCents: cents });
    setPanel(null);
    setNote({ ok: true, text: `Price saved: new subscribers pay ${usd(cents)} a month.` });
    router.refresh();
  };

  const subs = e?.activeSubscribers;
  return (
    <div className="frenz-ui mx-auto w-full max-w-2xl px-4 pb-10 pt-2 text-frenz-ink">
      <header>
        <div className="flex items-center justify-between">
          <Link href={`${profilePath(handle)}?tab=sub`} className="-ml-1 inline-flex min-h-[44px] items-center gap-0.5 text-[16px] font-bold text-frenz-blue no-underline">
            <ChevronLeft className="h-5 w-5" aria-hidden /> Profile
          </Link>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold tracking-[0.4px]", settings.active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300")}>
            <span aria-hidden className={cn("h-[7px] w-[7px] rounded-full", settings.active ? "bg-emerald-500" : "bg-amber-500")} />
            {settings.active ? "LIVE" : "PAUSED"}
          </span>
        </div>
        <h1 className="m-0 mt-1 font-heading text-[34px] font-extrabold leading-tight tracking-[-1px]">Subscriptions</h1>
        <p className="m-0 mt-0.5 text-[15px] text-frenz-muted">
          {subs !== undefined ? `${subs} ${subs === 1 ? "subscriber" : "subscribers"}` : failed ? "—" : "…"}
          {settings.priceCents ? ` · ${usd(settings.priceCents)} / month` : ""}
        </p>
      </header>

      {/* the money first: what can leave today */}
      <section aria-label="Your balance" className="mt-5 rounded-[22px] border border-frenz-line bg-frenz-card p-4 shadow-frenz-raised">
        <p className="m-0 text-[13px] font-semibold text-frenz-muted">Available to withdraw</p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <p className="m-0 min-w-0 break-all font-heading text-[34px] font-extrabold leading-none tracking-[-1px] tabular-nums">{money(e?.availableCents)}</p>
          <button
            type="button"
            onClick={() => {
              haptic("selection");
              setWithdrawing(true);
            }}
            className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-frenz-gradient-x px-5 font-heading text-[15px] font-bold text-white shadow-frenz-card transition active:scale-[0.98]"
          >
            <Wallet className="h-4 w-4" aria-hidden /> Withdraw
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 rounded-2xl bg-frenz-fill py-3">
          <Figure label="Earned all time" value={money(e?.lifetimeCents)} />
          <Figure label="Clearing" value={money(e?.pendingCents)} divided />
          <Figure label="Withdrawn" value={money(e?.withdrawnCents)} divided />
        </div>
      </section>

      <Link href="/exclusive/earnings" prefetch={false} className="mt-3 flex min-h-[56px] items-center gap-3 rounded-[20px] border border-frenz-line bg-frenz-card px-3.5 text-frenz-ink no-underline shadow-frenz-card">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-frenz-gradient text-white">
          <BarChart3 className="h-[18px] w-[18px]" />
        </span>
        <span className="flex-1 text-[15px] font-bold">Earnings &amp; analytics</span>
        <ChevronRightIcon size={15} strokeWidth={2.4} className="shrink-0 text-frenz-muted" />
      </Link>

      <Group title="Subscription">
        <Row icon={<Tag className="h-[18px] w-[18px]" />} label="Price" value={settings.priceCents ? `${usd(settings.priceCents)} / month` : "No price"} expanded={panel === "price"} onClick={() => open("price")} />
        {panel === "price" ? (
          <div className="px-3.5 pb-3.5">
            <label htmlFor="subs-price" className="text-[13px] font-semibold text-frenz-muted">
              New monthly price (USD) — applies to new subscriptions
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="subs-price"
                inputMode="decimal"
                value={price}
                onChange={(ev) => setPrice(ev.target.value.replace(/[^0-9.]/g, "").slice(0, 8))}
                className="h-11 min-w-0 flex-1 rounded-xl border-0 bg-frenz-fill px-3.5 text-base tabular-nums text-frenz-ink outline-none focus:ring-2 focus:ring-frenz-violet/40"
              />
              <button type="button" onClick={() => void savePrice()} disabled={!priceOk || saving} aria-busy={saving} className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-frenz-ink px-5 text-[14px] font-bold text-frenz-page disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
            {!priceOk && price ? <p className="m-0 mt-1 text-[12.5px] text-rose-600 dark:text-rose-400">Choose from {usd(bounds.minPriceCents)} to {usd(bounds.maxPriceCents)}.</p> : null}
            <SubBundleEditor monthlyCents={settings.priceCents} initial={settings.bundlePrices ?? NO_BUNDLES} bounds={bounds} ready={!!settings.bundlesReady} onSaved={(b) => setSettings({ ...settings, bundlePrices: b })} />
          </div>
        ) : null}
        <Row icon={<BadgePercent className="h-[18px] w-[18px]" />} label="Promotions" expanded={panel === "promotions"} onClick={() => open("promotions")} />
        {panel === "promotions" ? <SubPromotions monthlyCents={settings.priceCents} bundles={settings.bundlePrices ?? NO_BUNDLES} ready={!!settings.bundlesReady} /> : null}
        <div className="flex min-h-[64px] items-center gap-3 px-3.5 py-2.5">
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-frenz-violet/10 text-frenz-violet">
            <CirclePause className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Pause new subscribers</span>
            <span className="block text-[12.5px] text-frenz-muted">Current subscribers keep access</span>
          </span>
          <button type="button" role="switch" aria-checked={!settings.active} aria-label="Pause new subscribers" onClick={togglePause} className="-m-[7px] flex h-11 w-16 shrink-0 items-center justify-center">
            <span className={cn("flex h-[30px] w-[50px] rounded-full p-0.5 transition-colors", !settings.active ? "justify-end bg-frenz-violet" : "justify-start bg-[#E2DFEC] dark:bg-white/20")}>
              <span className="h-[26px] w-[26px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.2)]" />
            </span>
          </button>
        </div>
        <Row icon={<Megaphone className="h-[18px] w-[18px]" />} label="Announce to subscribers" expanded={panel === "announce"} onClick={() => open("announce")} />
        {panel === "announce" ? (
          <div className="px-3.5 pb-3.5">
            <CreatorAnnouncements creatorId={creatorId} />
          </div>
        ) : null}
        <Row icon={<Bell className="h-[18px] w-[18px]" />} label="Subscriber notifications" expanded={panel === "notify"} onClick={() => open("notify")} />
        {panel === "notify" ? (
          <div className="px-3.5 pb-3.5">
            <CreatorNotifySettings initial={settings.notifySubscribed ?? "both"} />
          </div>
        ) : null}
      </Group>

      {note ? (
        <p role="status" className={cn("m-0 mt-2 flex items-center gap-1.5 px-1 text-[13px] font-medium", note.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
          {note.ok ? <Check className="h-4 w-4" aria-hidden /> : null}
          {note.text}
        </p>
      ) : null}

      <h2 className="m-0 mb-2 mt-6 px-1 font-heading text-[17px] font-bold">Payout</h2>
      <SubPayoutSettings variant="list" feePercent={bounds.withdrawalFeePercent} />

      {withdrawing ? (
        <SubWithdrawSheet
          onClose={() => setWithdrawing(false)}
          onDone={() => void reload()}
        />
      ) : null}
    </div>
  );
}

function Figure({ label, value, divided = false }: { label: string; value: string; divided?: boolean }) {
  return (
    <span className={cn("flex min-w-0 flex-col items-center gap-0.5 px-1", divided && "border-l border-frenz-line")}>
      <span className="max-w-full truncate font-heading text-[17px] font-bold tabular-nums">{value}</span>
      <span className="text-center text-[12px] font-semibold leading-tight text-frenz-muted">{label}</span>
    </span>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-6">
      <h2 className="m-0 mb-2 px-1 font-heading text-[17px] font-bold">{title}</h2>
      <div className="divide-y divide-frenz-line overflow-hidden rounded-[20px] border border-frenz-line bg-frenz-card shadow-frenz-card">{children}</div>
    </section>
  );
}

function Row({ icon, label, value, expanded, onClick }: { icon: ReactNode; label: string; value?: string; expanded: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={expanded} className="flex min-h-[56px] w-full items-center gap-3 px-3.5 text-left transition active:bg-frenz-fill">
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-frenz-violet/10 text-frenz-violet">
        {icon}
      </span>
      <span className="flex-1 text-[15px] font-semibold">{label}</span>
      {value ? <span className="text-[14px] text-frenz-muted">{value}</span> : null}
      <ChevronRightIcon size={15} strokeWidth={2.4} className={cn("shrink-0 text-frenz-muted transition-transform duration-150", expanded && "rotate-90")} />
    </button>
  );
}
