"use client";

import { Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { GLASS, GlassGroup, PersonAvatar, quietPill } from "@/features/friends/ui";
import { haptic } from "@/lib/motion/haptics";
import type { SubState } from "@/lib/sub/lifecycle";
import type { SubscriberRow } from "@/lib/sub/subscriptions";
import { cn } from "@/lib/utils";

/**
 * The creator's PAID subscribers (Frenz Exclusive Part 5), 30 at a time from
 * /api/members/subscribers — never the whole list in the browser. The server lists only the
 * signed-in creator's own subscribers and sends no amounts or payment details.
 */

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
const TONE: Record<SubState, string> = {
  active: "bg-primary/10 text-primary",
  ending: "bg-gold/15 text-foreground",
  pending: "bg-muted text-muted-foreground",
  expired: "bg-muted text-muted-foreground",
  refunded: "bg-muted text-foreground",
  ended: "bg-muted text-muted-foreground",
  removed: "bg-muted text-muted-foreground",
  unavailable: "bg-muted text-muted-foreground",
};

type Page = { items: SubscriberRow[]; next: string | null };

export function SubscribersList() {
  const [filter, setFilter] = useState<"current" | "all">("current");
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (f: "current" | "all", cursor: string | null) => {
    const mine = ++seq.current;
    setLoading(true);
    const res = await fetch(`/api/members/subscribers?filter=${f}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as Page | null;
    // a filter switched mid-flight: only the newest request draws
    if (mine !== seq.current) return;
    setLoading(false);
    if (!res?.ok || !j) return setError(true);
    setError(false);
    setPage((p) => (cursor && p ? { items: [...p.items, ...j.items.filter((x) => !p.items.some((y) => y.membershipId === x.membershipId))], next: j.next } : j));
  }, []);

  useEffect(() => {
    setPage(null);
    void load(filter, null);
  }, [filter, load]);

  const remove = async (r: SubscriberRow) => {
    haptic("selection");
    setNote(null);
    const res = await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "remove", memberId: r.person.id }) }).catch(() => null);
    if (!res?.ok) return setNote(res ? "Couldn't remove them. Try again." : "You're offline.");
    setNote(`${r.person.displayName} was removed. Their access ended now. A refund, if one is due, is handled by Frenz support.`);
    void load(filter, null);
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {(
          [
            ["current", "With access"],
            ["all", "Everyone who subscribed"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]", filter === k && "bg-primary/10 text-primary")}>
            {l}
          </button>
        ))}
      </div>
      <div aria-live="polite">{note ? <p className={cn("mb-2 rounded-2xl px-3.5 py-2.5 text-[13px]", GLASS)}>{note}</p> : null}</div>
      {page === null && loading ? (
        <ul aria-label="Loading subscribers" className={cn("divide-y divide-black/[0.06] overflow-hidden rounded-[22px] dark:divide-white/[0.07]", GLASS)}>
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-3.5 py-3">
              <span className="h-11 w-11 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
              <span className="h-3.5 w-40 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
            </li>
          ))}
        </ul>
      ) : page?.items.length ? (
        <GlassGroup label="Subscribers">
          {page.items.map((r) => {
            const expanded = open === r.membershipId;
            return (
              <li key={r.membershipId}>
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.membershipId)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition active:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <PersonAvatar user={r.person} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-semibold">{r.person.displayName}</span>
                    <span className="block truncate text-[12.5px] text-muted-foreground" suppressHydrationWarning>
                      {r.access ? `Access until ${fmt(r.periodEnd)}` : r.state === "expired" ? `Ended ${fmt(r.periodEnd)}` : `Since ${fmt(r.startedAt)}`}
                    </span>
                  </span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold uppercase tracking-[0.04em]", TONE[r.state])}>{r.label}</span>
                </button>
                {expanded ? (
                  <div className="space-y-2 border-t border-black/[0.06] px-3.5 py-3 text-[12.5px] text-muted-foreground dark:border-white/[0.07]">
                    <p suppressHydrationWarning>
                      Subscribed since {fmt(r.startedAt)} · {r.access ? `access until ${fmt(r.periodEnd)}` : "no access now"}
                      {r.state === "ending" ? " · won't renew" : ""}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/u/${r.person.handle}`} prefetch={false} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
                        Profile
                      </Link>
                      <Link href={`/messages/new/${r.person.id}`} prefetch={false} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
                        Message
                      </Link>
                      {r.access ? (
                        <button type="button" onClick={() => void remove(r)} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px] text-rose-600")}>
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </GlassGroup>
      ) : !error ? (
        <p className={cn("rounded-[22px] px-3.5 py-3 text-[13px] text-muted-foreground", GLASS)}>{filter === "current" ? "Nobody has access right now. Share your exclusive posts to find subscribers." : "Nobody has subscribed yet."}</p>
      ) : null}
      {error ? (
        <div className={cn("mt-2 flex items-center justify-between gap-3 rounded-[22px] px-3.5 py-3", GLASS)}>
          <p className="text-[13px] text-muted-foreground">Couldn&apos;t load your subscribers.</p>
          <button type="button" onClick={() => void load(filter, page?.next ?? null)} disabled={loading} className={quietPill}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Retry
          </button>
        </div>
      ) : page?.next ? (
        <button type="button" onClick={() => void load(filter, page.next)} disabled={loading} className={cn(quietPill, "mt-2 w-full justify-center")}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} {loading ? "Loading…" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
