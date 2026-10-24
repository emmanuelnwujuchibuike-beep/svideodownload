"use client";

import { Loader2, Search } from "lucide-react";
import { useState } from "react";

import { usd } from "@/lib/creator/membership/engine";
import { cn } from "@/lib/utils";

/**
 * Admin → Rewards: SUB → "Bundles & promotions" (0277). Look a creator up by @handle (or id) to see their bundle
 * prices, every promotion with its status, redemptions, live checkouts and limit, and the verified purchases that used
 * them. Pause is moderation: audited with the admin's id and reason, and only the team can lift it.
 */

interface Promo {
  id: string;
  name: string;
  kind: "percent" | "fixed";
  percentOff: number | null;
  fixedPriceCents: number | null;
  durations: number[];
  startsAt: string;
  endsAt: string;
  maxRedemptions: number | null;
  status: "scheduled" | "active" | "expired" | "paused";
  pausedBy: "creator" | "admin" | null;
  redeemed: number;
  live: number;
}
interface Creator {
  creatorId: string;
  handle: string | null;
  monthlyCents: number | null;
  bundlePrices: Record<string, number | null>;
  promotions: Promo[];
  purchases: { reference: string; promotionId: string; months: number; priceCents: number; totalCents: number; status: string; paidAt: string | null }[];
}

const input = "rounded-lg border border-black/[0.08] bg-white/70 px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:border-white/10 dark:bg-white/[0.06]";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

export function SubAdminPromotions() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [data, setData] = useState<Creator | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});

  const load = async (who = q) => {
    if (!who.trim()) return;
    setBusy("load");
    setMsg(null);
    const res = await fetch(`/api/admin/memberships/promotions?creator=${encodeURIComponent(who.trim())}`, { cache: "no-store" }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { creator?: Creator; error?: string } | null;
    setBusy(null);
    if (res?.ok && j?.creator) setData(j.creator);
    else {
      setData(null);
      setMsg(j?.error ?? "Couldn't load that creator.");
    }
  };

  const pause = async (id: string) => {
    const note = (reason[id] ?? "").trim();
    if (note.length < 3) {
      setMsg("Give a reason of at least 3 characters before pausing.");
      return;
    }
    setBusy(id);
    const res = await fetch("/api/admin/memberships/promotions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, note }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(null);
    if (!res?.ok) setMsg(j?.error ?? "Couldn't pause it.");
    else await load(data?.handle ?? data?.creatorId ?? q);
  };

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">Bundles &amp; promotions</h3>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="@handle or creator id" aria-label="Creator handle or id" className={cn(input, "min-w-0 flex-1")} />
        <button type="submit" disabled={busy === "load"} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {busy === "load" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />} Look up
        </button>
      </form>
      {msg ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{msg}</p> : null}
      {data ? (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            @{data.handle ?? data.creatorId} · monthly {data.monthlyCents ? usd(data.monthlyCents) : "—"} · 3 months {data.bundlePrices["3"] ? usd(data.bundlePrices["3"]) : "off"} · 6 months {data.bundlePrices["6"] ? usd(data.bundlePrices["6"]) : "off"} · 12 months {data.bundlePrices["12"] ? usd(data.bundlePrices["12"]) : "off"}
          </p>
          {data.promotions.length === 0 ? <p className="text-xs text-muted-foreground">No promotions.</p> : null}
          {data.promotions.map((p) => (
            <div key={p.id} className="rounded-xl border border-black/[0.06] p-3 dark:border-white/10">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{p.name}</span>
                <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-semibold dark:bg-white/10">
                  {p.status}
                  {p.pausedBy === "admin" ? " · by admin" : ""}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {p.kind === "percent" ? `${p.percentOff}% off` : `${usd(p.fixedPriceCents ?? 0)} fixed`} · {p.durations.join(", ")} months · {day(p.startsAt)} – {day(p.endsAt)} · {p.redeemed} redeemed{p.maxRedemptions ? ` of ${p.maxRedemptions}` : ""}
                {p.live > p.redeemed ? ` · ${p.live - p.redeemed} in checkout` : ""}
              </p>
              {p.status !== "expired" && p.pausedBy !== "admin" ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input value={reason[p.id] ?? ""} onChange={(e) => setReason({ ...reason, [p.id]: e.target.value })} placeholder="Reason (audited)" aria-label={`Reason for pausing ${p.name}`} className={cn(input, "min-w-0 flex-1")} />
                  <button type="button" disabled={busy === p.id} onClick={() => void pause(p.id)} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                    {busy === p.id ? "Pausing…" : "Pause"}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {data.purchases.length ? (
            <div>
              <p className="text-xs font-semibold">Purchases that used a promotion</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {data.purchases.map((x) => (
                  <li key={x.reference}>
                    {x.reference.slice(0, 18)}… · {x.months} mo · {usd(x.priceCents)} to the creator ({usd(x.totalCents)} paid) · {x.status}
                    {x.paidAt ? ` · ${day(x.paidAt)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
