"use client";

import { Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { usd } from "@/lib/creator/membership/engine";
import { haptic } from "@/lib/motion/haptics";
import { durationLabel, promotionPriceCents, regularPriceFor, SUB_DURATIONS, type BundlePrices, type PromotionKind, type PromotionStatus, type SubMonths } from "@/lib/sub/pricing";
import { cn } from "@/lib/utils";

/**
 * The creator's promotions in the Subscriptions dashboard (0277). Create one (percent off or a fixed price, the
 * durations it covers, a window and an optional limit), pause or resume it, edit it. Every rule is the server's
 * (/api/sub/promotions → lib/sub/promotions.ts): a promotion that has been used keeps its price, durations and start
 * — the server refuses the change and says to pause it and make a new one. A purchase always keeps the price it was
 * opened at, so nothing here can reprice a checkout.
 */

interface Promo {
  id: string;
  name: string;
  description: string | null;
  kind: PromotionKind;
  percentOff: number | null;
  fixedPriceCents: number | null;
  durations: SubMonths[];
  startsAt: string;
  endsAt: string;
  maxRedemptions: number | null;
  paused: boolean;
  pausedBy: "creator" | "admin" | null;
  status: PromotionStatus;
  redeemed: number;
  live: number;
  used: boolean;
}

const STATUS_LABEL: Record<PromotionStatus, string> = { active: "Active", scheduled: "Scheduled", expired: "Ended", paused: "Paused" };
const STATUS_TONE: Record<PromotionStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  scheduled: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  expired: "bg-frenz-fill text-frenz-muted",
  paused: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
};

/** an ISO time ↔ the value of a datetime-local input, in the creator's own time zone */
const toLocal = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : "");
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

interface Draft {
  id: string | null;
  name: string;
  description: string;
  kind: PromotionKind;
  value: string;
  durations: SubMonths[];
  start: string;
  end: string;
  limit: string;
  locked: boolean;
}

const blank = (offered: SubMonths[]): Draft => ({ id: null, name: "", description: "", kind: "percent", value: "", durations: offered.slice(0, 1), start: toLocal(new Date().toISOString()), end: toLocal(new Date(Date.now() + 7 * 86_400_000).toISOString()), limit: "", locked: false });

export function SubPromotions({ monthlyCents, bundles, ready }: { monthlyCents: number | null; bundles: BundlePrices; ready: boolean }) {
  const offered = SUB_DURATIONS.filter((m) => regularPriceFor(m, monthlyCents, bundles) !== null);
  const [items, setItems] = useState<Promo[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/sub/promotions", { cache: "no-store" }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { items?: Promo[]; error?: string } | null;
    if (res?.ok && j?.items) {
      setItems(j.items);
      setFailed(null);
    } else setFailed(j?.error ?? "Couldn't load your promotions.");
  }, []);
  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  if (!ready) return <p className="m-0 px-3.5 py-3 text-[12.5px] text-frenz-muted">Promotions arrive with the next update.</p>;

  const post = async (payload: Record<string, unknown>, key: string, done: string) => {
    haptic("selection");
    setBusy(key);
    setNote(null);
    const res = await fetch("/api/sub/promotions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(null);
    if (!res?.ok) {
      setNote({ ok: false, text: j?.error ?? "Couldn't save that. Try again." });
      return false;
    }
    setNote({ ok: true, text: done });
    await load();
    return true;
  };

  const edit = (p: Promo) =>
    setDraft({ id: p.id, name: p.name, description: p.description ?? "", kind: p.kind, value: p.kind === "percent" ? String(p.percentOff ?? "") : ((p.fixedPriceCents ?? 0) / 100).toFixed(2), durations: p.durations, start: toLocal(p.startsAt), end: toLocal(p.endsAt), limit: p.maxRedemptions ? String(p.maxRedemptions) : "", locked: p.used });

  const submit = async () => {
    if (!draft) return;
    const num = Number(draft.value);
    const payload = {
      ...(draft.id ? { op: "edit", id: draft.id } : { op: "create" }),
      name: draft.name,
      description: draft.description.trim() || null,
      kind: draft.kind,
      percentOff: draft.kind === "percent" ? Math.round(num) : null,
      fixedPriceCents: draft.kind === "fixed" ? Math.round(num * 100) : null,
      durations: draft.durations,
      startsAt: fromLocal(draft.start),
      endsAt: fromLocal(draft.end),
      maxRedemptions: draft.limit ? Math.round(Number(draft.limit)) : null,
    };
    if (await post(payload, "form", draft.id ? "Promotion updated." : "Promotion created.")) setDraft(null);
  };

  // what each chosen duration would cost under the draft — the same rule checkout applies
  const preview = draft
    ? draft.durations.map((m) => {
        const regular = regularPriceFor(m, monthlyCents, bundles);
        const num = Number(draft.value);
        const price = regular && draft.value ? promotionPriceCents(draft.kind === "percent" ? { kind: "percent", percentOff: Math.round(num), fixedPriceCents: null } : { kind: "fixed", percentOff: null, fixedPriceCents: Math.round(num * 100) }, regular) : null;
        return { m, regular, price };
      })
    : [];

  return (
    <div className="px-3.5 pb-3.5">
      {failed ? <p className="m-0 mt-2 text-[12.5px] text-rose-600 dark:text-rose-400">{failed}</p> : null}
      {items === null && !failed ? <p className="m-0 mt-2 text-[12.5px] text-frenz-muted">Loading…</p> : null}
      {items?.length === 0 && !draft ? <p className="m-0 mt-2 text-[13px] text-frenz-muted">No promotions yet. A promotion lowers the price of chosen durations for a set time.</p> : null}
      <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
        {items?.map((p) => (
          <li key={p.id} className="rounded-2xl bg-frenz-fill px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[14.5px] font-bold">{p.name}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-bold", STATUS_TONE[p.status])}>{STATUS_LABEL[p.status]}</span>
            </div>
            <p className="m-0 mt-0.5 text-[12.5px] text-frenz-muted">
              {p.kind === "percent" ? `${p.percentOff}% off` : `${usd(p.fixedPriceCents ?? 0)} fixed`} · {p.durations.map(durationLabel).join(", ")} · {when(p.startsAt)} – {when(p.endsAt)}
            </p>
            <p className="m-0 mt-0.5 text-[12.5px] text-frenz-muted">
              {p.redeemed} redeemed{p.maxRedemptions ? ` of ${p.maxRedemptions}` : ""}
              {p.live > p.redeemed ? ` · ${p.live - p.redeemed} in checkout` : ""}
              {p.pausedBy === "admin" ? " · paused by Frenz" : ""}
            </p>
            {p.status !== "expired" ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => edit(p)} className="h-9 rounded-full bg-frenz-card px-3.5 text-[13px] font-bold">
                  Edit
                </button>
                {p.pausedBy !== "admin" ? (
                  <button type="button" disabled={busy === p.id} onClick={() => void post({ op: p.paused ? "resume" : "pause", id: p.id }, p.id, p.paused ? "Promotion resumed." : "Promotion paused.")} className="flex h-9 items-center gap-1.5 rounded-full bg-frenz-card px-3.5 text-[13px] font-bold disabled:opacity-50">
                    {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                    {p.paused ? "Resume" : "Pause"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {draft ? (
        <div className="mt-3 rounded-2xl border border-frenz-line p-3">
          <p className="m-0 text-[14px] font-bold">{draft.id ? "Edit promotion" : "New promotion"}</p>
          {draft.locked ? <p className="m-0 mt-1 text-[12.5px] text-frenz-muted">Already used: the price, durations and start stay as they are. You can rename it, move the end date or raise the limit — or pause it and create a new one.</p> : null}
          <label className="mt-2 block text-[12.5px] font-semibold text-frenz-muted">
            Name
            <input value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="mt-1 h-10 w-full rounded-xl border-0 bg-frenz-fill px-3 text-[15px] text-frenz-ink outline-none focus:ring-2 focus:ring-frenz-violet/40" />
          </label>
          <label className="mt-2 block text-[12.5px] font-semibold text-frenz-muted">
            Description (optional)
            <input value={draft.description} maxLength={200} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="mt-1 h-10 w-full rounded-xl border-0 bg-frenz-fill px-3 text-[15px] text-frenz-ink outline-none focus:ring-2 focus:ring-frenz-violet/40" />
          </label>
          <div role="radiogroup" aria-label="Discount type" className="mt-2 flex gap-2">
            {(["percent", "fixed"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={draft.kind === k} disabled={draft.locked} onClick={() => setDraft({ ...draft, kind: k, value: "" })} className={cn("h-9 flex-1 rounded-full text-[13px] font-bold disabled:opacity-50", draft.kind === k ? "bg-frenz-violet text-white" : "bg-frenz-fill")}>
                {k === "percent" ? "% off" : "Fixed price"}
              </button>
            ))}
          </div>
          <label className="mt-2 block text-[12.5px] font-semibold text-frenz-muted">
            {draft.kind === "percent" ? "Discount (1–90%)" : "Promotional price (USD)"}
            <input inputMode="decimal" disabled={draft.locked} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value.replace(/[^0-9.]/g, "").slice(0, 9) })} className="mt-1 h-10 w-full rounded-xl border-0 bg-frenz-fill px-3 text-[15px] tabular-nums text-frenz-ink outline-none focus:ring-2 focus:ring-frenz-violet/40 disabled:opacity-60" />
          </label>
          <fieldset className="m-0 mt-2 border-0 p-0">
            <legend className="text-[12.5px] font-semibold text-frenz-muted">Applies to</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {offered.map((m) => {
                const on = draft.durations.includes(m);
                return (
                  <button key={m} type="button" aria-pressed={on} disabled={draft.locked} onClick={() => setDraft({ ...draft, durations: on ? draft.durations.filter((x) => x !== m) : [...draft.durations, m].sort((a, b) => a - b) })} className={cn("h-9 rounded-full px-3.5 text-[13px] font-bold disabled:opacity-50", on ? "bg-frenz-violet text-white" : "bg-frenz-fill")}>
                    {durationLabel(m)}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block text-[12.5px] font-semibold text-frenz-muted">
              Starts
              <input type="datetime-local" disabled={draft.locked} value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} className="mt-1 h-10 w-full rounded-xl border-0 bg-frenz-fill px-3 text-[14px] text-frenz-ink outline-none focus:ring-2 focus:ring-frenz-violet/40 disabled:opacity-60" />
            </label>
            <label className="block text-[12.5px] font-semibold text-frenz-muted">
              Ends
              <input type="datetime-local" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className="mt-1 h-10 w-full rounded-xl border-0 bg-frenz-fill px-3 text-[14px] text-frenz-ink outline-none focus:ring-2 focus:ring-frenz-violet/40" />
            </label>
          </div>
          <label className="mt-2 block text-[12.5px] font-semibold text-frenz-muted">
            Limit (optional — how many can buy at this price)
            <input inputMode="numeric" value={draft.limit} onChange={(e) => setDraft({ ...draft, limit: e.target.value.replace(/[^0-9]/g, "").slice(0, 7) })} className="mt-1 h-10 w-full rounded-xl border-0 bg-frenz-fill px-3 text-[15px] tabular-nums text-frenz-ink outline-none focus:ring-2 focus:ring-frenz-violet/40" />
          </label>
          {preview.length ? (
            <ul className="m-0 mt-2 list-none p-0 text-[12.5px] text-frenz-muted">
              {preview.map(({ m, regular, price }) => (
                <li key={m}>
                  {durationLabel(m)}: {regular ? (price !== null ? <><s>{usd(regular)}</s> → <span className="font-semibold text-frenz-ink">{usd(price)}</span></> : draft.value ? <span className="text-rose-600 dark:text-rose-400">not valid for {usd(regular)}</span> : usd(regular)) : "—"}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void submit()} disabled={busy === "form"} aria-busy={busy === "form"} className="flex h-10 items-center gap-1.5 rounded-full bg-frenz-ink px-5 text-[14px] font-bold text-frenz-page disabled:opacity-50">
              {busy === "form" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {draft.id ? "Save" : "Create"}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="h-10 rounded-full bg-frenz-fill px-5 text-[14px] font-bold">
              Cancel
            </button>
          </div>
        </div>
      ) : offered.length ? (
        <button type="button" onClick={() => setDraft(blank(offered))} className="mt-3 flex h-10 items-center gap-1.5 rounded-full bg-frenz-gradient-x px-4 text-[14px] font-bold text-white">
          <Plus className="h-4 w-4" aria-hidden /> New promotion
        </button>
      ) : null}
      {note ? <p role="status" className={cn("m-0 mt-2 text-[12.5px] font-medium", note.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>{note.text}</p> : null}
    </div>
  );
}
