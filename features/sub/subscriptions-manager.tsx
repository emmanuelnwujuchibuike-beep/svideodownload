"use client";

import { ArrowRight, BadgeCheck, CalendarClock, ChevronRight, Loader2, Receipt, RefreshCw, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { PersonAvatar, SectionHeader } from "@/features/friends/ui";
import { EX_CARD, EX_SHEET, ExGroup, exPrimary, exQuiet } from "@/features/sub/ui";
import { haptic } from "@/lib/motion/haptics";
import type { SubState, TxState } from "@/lib/sub/lifecycle";
import type { SubscriptionItem, TxPage } from "@/lib/sub/subscriptions";
import { cn } from "@/lib/utils";

/**
 * Subscriptions (Frenz Exclusive Part 5) — the member's own paid subscriptions and payments.
 *
 * Everything shown is the server's: state, access-until, prices and statuses arrive from
 * /api/sub/subscriptions and /api/sub/transactions, and after every cancel / resume the list is
 * read again rather than drawn ahead of the server. Renewing is the existing checkout; nothing
 * here can make a payment look confirmed.
 */

const RETURN_PATH = "/account/subscriptions";
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

const STATE_TONE: Record<SubState, string> = {
  active: "bg-primary/10 text-primary",
  ending: "bg-gold/15 text-foreground",
  pending: "bg-accent/10 text-accent",
  expired: "bg-black/[0.05] dark:bg-white/[0.07] text-muted-foreground",
  refunded: "bg-black/[0.05] dark:bg-white/[0.07] text-foreground",
  ended: "bg-black/[0.05] dark:bg-white/[0.07] text-muted-foreground",
  removed: "bg-black/[0.05] dark:bg-white/[0.07] text-muted-foreground",
  unavailable: "bg-black/[0.05] dark:bg-white/[0.07] text-muted-foreground",
};
const TX_TONE: Record<TxState, string> = {
  paid: "bg-primary/10 text-primary",
  pending: "bg-accent/10 text-accent",
  not_completed: "bg-black/[0.05] dark:bg-white/[0.07] text-muted-foreground",
  refund_due: "bg-gold/15 text-foreground",
  refunded: "bg-black/[0.05] dark:bg-white/[0.07] text-foreground",
  disputed: "bg-black/[0.05] dark:bg-white/[0.07] text-foreground",
  reversed: "bg-black/[0.05] dark:bg-white/[0.07] text-foreground",
};

function Chip({ tone, children }: { tone: string; children: string }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11.5px] font-bold uppercase tracking-[0.04em]", tone)}>{children}</span>;
}

async function json<T>(res: Response | null): Promise<T | null> {
  return ((await res?.json().catch(() => null)) as T | null) ?? null;
}

export function SubscriptionsManager({ initial, initialTx }: { initial: SubscriptionItem[] | null; initialTx: TxPage | null }) {
  const [items, setItems] = useState<SubscriptionItem[] | null>(initial);
  const [loadError, setLoadError] = useState(initial === null);
  const [reloading, setReloading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<SubscriptionItem | null>(null);

  const reload = async () => {
    setReloading(true);
    const res = await fetch("/api/sub/subscriptions", { cache: "no-store" }).catch(() => null);
    const j = await json<{ items?: SubscriptionItem[] }>(res);
    setReloading(false);
    if (res?.ok && j?.items) {
      setItems(j.items);
      setLoadError(false);
    } else setLoadError(true);
  };

  const mutate = async (op: "cancel" | "resume", item: SubscriptionItem) => {
    haptic("selection");
    setBusy(`${op}:${item.id}`);
    setNote(null);
    const res = await fetch("/api/sub/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, creatorId: item.creator.id }) }).catch(() => null);
    const j = await json<{ error?: string }>(res);
    setBusy(null);
    setConfirming(null);
    if (!res?.ok) setNote(j?.error ?? (res ? "Couldn't save that. Try again." : "You're offline. Nothing changed."));
    else setNote(op === "cancel" ? `Cancelled. You keep access to ${item.creator.displayName} until ${fmt(item.periodEnd)}.` : `You're keeping your subscription to ${item.creator.displayName}.`);
    await reload();
  };

  const renew = async (item: SubscriptionItem) => {
    haptic("selection");
    setBusy(`renew:${item.id}`);
    setNote(null);
    const res = await fetch("/api/sub/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorId: item.creator.id, returnPath: RETURN_PATH }) }).catch(() => null);
    const j = await json<{ url?: string; error?: string }>(res);
    if (res?.ok && j?.url) {
      window.location.assign(j.url);
      return;
    }
    setBusy(null);
    setNote(j?.error ?? "Couldn't open the payment. Nothing was charged. Try again.");
  };

  return (
    <div>
      <div aria-live="polite">{note ? <p className={cn("mb-4 rounded-2xl px-3.5 py-2.5 text-[13.5px]", EX_CARD)}>{note}</p> : null}</div>

      <section className="mb-7" aria-labelledby="subs-list">
        <SectionHeader id="subs-list" title="Your subscriptions" count={items?.length} />
        {loadError ? (
          <div className={cn("rounded-[22px] px-4 py-4", EX_CARD)}>
            <p className="text-[14px] font-semibold">Couldn&apos;t load your subscriptions</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Your access isn&apos;t affected. Try again in a moment.</p>
            <button type="button" onClick={() => void reload()} disabled={reloading} className={cn(exQuiet, "mt-3")}>
              {reloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Retry
            </button>
          </div>
        ) : !items?.length ? (
          <div className={cn("rounded-[22px] px-4 py-5 text-center", EX_CARD)}>
            <p className="text-[15px] font-semibold">No subscriptions yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">When you subscribe to a creator&apos;s exclusive posts, it shows here with the date your access runs to.</p>
            <Link href="/exclusive" prefetch={false} className={cn(exPrimary, "mt-3.5")}>
              Explore Exclusive <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((it) => (
              <li key={it.id} className={cn("rounded-[22px] px-4 py-3.5", EX_CARD)}>
                <div className="flex items-start gap-3">
                  <Link href={`/u/${it.creator.handle}`} prefetch={false} className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <PersonAvatar user={it.creator} size={44} />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link href={`/u/${it.creator.handle}`} prefetch={false} className="flex min-w-0 items-center gap-1 text-[15px] font-bold leading-tight hover:underline">
                        <span className="truncate">{it.creator.displayName}</span>
                        {it.creator.verified ? <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-label="Verified" /> : null}
                      </Link>
                      <Chip tone={STATE_TONE[it.state]}>{it.label}</Chip>
                    </div>
                    <p className="mt-1 text-[13px] text-muted-foreground" suppressHydrationWarning>
                      {it.line}
                    </p>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
                  <div className="rounded-2xl bg-black/[0.03] px-3 py-2 dark:bg-white/[0.05]">
                    <dt className="text-muted-foreground">Subscribed since</dt>
                    <dd className="font-semibold" suppressHydrationWarning>
                      {fmtDay(it.startedAt)}
                    </dd>
                  </div>
                  <div className="rounded-2xl bg-black/[0.03] px-3 py-2 dark:bg-white/[0.05]">
                    <dt className="text-muted-foreground">{it.access ? "Access until" : "Access ended"}</dt>
                    <dd className="font-semibold" suppressHydrationWarning>
                      {it.state === "refunded" || it.state === "removed" || it.state === "unavailable" ? "—" : fmt(it.periodEnd)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  {it.access ? (
                    <Link href={`/u/${it.creator.handle}?tab=sub`} prefetch={false} className={exQuiet}>
                      Open exclusive posts <ChevronRight className="h-4 w-4" aria-hidden />
                    </Link>
                  ) : null}
                  {it.actions.renew ? (
                    <button type="button" onClick={() => void renew(it)} disabled={!!busy} className={exPrimary}>
                      {busy === `renew:${it.id}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
                      {busy === `renew:${it.id}` ? "Opening secure payment…" : `${it.access ? "Renew early" : "Renew"}${it.renewPrice ? ` · ${it.renewPrice}` : ""}`}
                    </button>
                  ) : null}
                  {it.actions.resume ? (
                    <button type="button" onClick={() => void mutate("resume", it)} disabled={!!busy} className={exQuiet}>
                      {busy === `resume:${it.id}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Keep subscription
                    </button>
                  ) : null}
                  {it.actions.cancel ? (
                    <button type="button" onClick={() => setConfirming(it)} disabled={!!busy} className={cn(exQuiet, "text-muted-foreground")}>
                      Cancel subscription
                    </button>
                  ) : null}
                </div>
                {it.access && !it.actions.renew ? (
                  <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden /> You can renew in the last 3 days of your access.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2.5 px-1 text-[11.5px] text-muted-foreground">Subscriptions never renew automatically and no card is kept on file. You pay again only if you choose to renew.</p>
      </section>

      <Payments initial={initialTx} />

      {confirming ? <CancelSheet item={confirming} busy={busy === `cancel:${confirming.id}`} onConfirm={() => void mutate("cancel", confirming)} onClose={() => setConfirming(null)} /> : null}
    </div>
  );
}

function CancelSheet({ item, busy, onConfirm, onClose }: { item: SubscriptionItem; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keepRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center" onClick={() => (busy ? null : onClose())}>
      <div role="dialog" aria-modal="true" aria-labelledby="cancel-title" onClick={(e) => e.stopPropagation()} className={cn(EX_SHEET, "w-full max-w-md px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-5 shadow-2xl sm:pb-5")}>
        <h2 id="cancel-title" className="text-[18px] font-bold leading-tight">
          Cancel your subscription to {item.creator.displayName}?
        </h2>
        <ul className="mt-3 space-y-1.5 text-[13.5px] text-foreground/85">
          <li suppressHydrationWarning>· You keep access until {fmt(item.periodEnd)}.</li>
          <li>· Nothing is refunded for the time left.</li>
          <li>· There&apos;s no automatic renewal, so no future charge is being stopped. We just won&apos;t remind you to renew.</li>
          <li>· You can change your mind until then.</li>
        </ul>
        <div className="mt-5 grid gap-2">
          <button ref={keepRef} type="button" onClick={onClose} disabled={busy} className={cn(exPrimary, "w-full justify-center")}>
            Keep subscription
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className={cn(exQuiet, "w-full justify-center")}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Cancel at the end of the period
          </button>
        </div>
      </div>
    </div>
  );
}

function Payments({ initial }: { initial: TxPage | null }) {
  const [page, setPage] = useState<TxPage | null>(initial);
  const [error, setError] = useState(initial === null);
  const [loading, setLoading] = useState(false);

  const load = async (cursor: string | null) => {
    setLoading(true);
    const res = await fetch(`/api/sub/transactions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" }).catch(() => null);
    const j = await json<TxPage>(res);
    setLoading(false);
    if (!res?.ok || !j) return setError(true);
    setError(false);
    setPage((p) => (cursor && p ? { items: [...p.items, ...j.items.filter((x) => !p.items.some((y) => y.id === x.id))], next: j.next } : j));
  };

  return (
    <section className="mb-8" aria-labelledby="subs-payments">
      <SectionHeader id="subs-payments" title="Payments and receipts" />
      {page?.items.length ? (
        <ExGroup label="Payments">
          {page.items.map((t) => (
            <li key={t.id}>
              <Link href={`/account/subscriptions/receipt/${t.id}`} prefetch={false} className="flex items-center gap-3 px-3.5 py-3 transition active:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-black/[0.04] dark:bg-white/[0.07]">
                  <Receipt className="h-[18px] w-[18px] text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[14px] font-semibold">{t.creator?.displayName ?? "A creator"}</span>
                    <Chip tone={TX_TONE[t.state]}>{t.label}</Chip>
                  </span>
                  <span className="mt-0.5 block text-[12.5px] tabular-nums text-muted-foreground" suppressHydrationWarning>
                    {fmtDay(t.date)} · {t.charged ?? t.breakdown.total}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ExGroup>
      ) : !error ? (
        <p className={cn("rounded-[22px] px-3.5 py-3 text-[13px] text-muted-foreground", EX_CARD)}>No subscription payments yet.</p>
      ) : null}
      {error ? (
        <div className={cn("mt-2 flex items-center justify-between gap-3 rounded-[22px] px-3.5 py-3", EX_CARD)}>
          <p className="text-[13px] text-muted-foreground">Couldn&apos;t load your payments.</p>
          <button type="button" onClick={() => void load(page?.next ?? null)} disabled={loading} className={exQuiet}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Retry
          </button>
        </div>
      ) : page?.next ? (
        <button type="button" onClick={() => void load(page.next)} disabled={loading} className={cn(exQuiet, "mt-2 w-full justify-center")}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} {loading ? "Loading…" : "Show older payments"}
        </button>
      ) : null}
    </section>
  );
}
