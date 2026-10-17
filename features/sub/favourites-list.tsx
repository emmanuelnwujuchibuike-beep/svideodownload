"use client";

import { BadgeCheck, ChevronRight, Loader2, Lock, RefreshCw, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PersonAvatar } from "@/features/friends/ui";
import { EX_CARD, ExGroup, exPrimary, exQuiet } from "@/features/sub/ui";
import { haptic } from "@/lib/motion/haptics";
import type { FavouriteCreator } from "@/lib/sub/favourites";
import { cn } from "@/lib/utils";

/**
 * Favourite creators (Frenz Exclusive Part 6) — the member's own list, 24 at a time from
 * /api/sub/favourites. Public profile facts only: name, handle, photo, and whether the creator is
 * taking subscriptions (what their profile tab already shows anyone). Removing a favourite never
 * touches a subscription.
 */

type Page = { items: FavouriteCreator[]; next: string | null };

export function FavouritesList({ initial }: { initial: Page | null }) {
  const [page, setPage] = useState<Page | null>(initial);
  const [error, setError] = useState(initial === null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = async (cursor: string | null) => {
    setLoading(true);
    const res = await fetch(`/api/sub/favourites${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as Page | null;
    setLoading(false);
    if (!res?.ok || !j) return setError(true);
    setError(false);
    setPage((p) => (cursor && p ? { items: [...p.items, ...j.items.filter((x) => !p.items.some((y) => y.id === x.id))], next: j.next } : j));
  };

  const remove = async (c: FavouriteCreator) => {
    haptic("selection");
    const before = page;
    setPage((p) => (p ? { ...p, items: p.items.filter((x) => x.id !== c.id) } : p));
    setNote(null);
    const res = await fetch("/api/sub/favourites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "remove", creatorId: c.id }) }).catch(() => null);
    if (!res?.ok) {
      setPage(before);
      setNote(`Couldn't remove ${c.displayName}. Try again.`);
    } else setNote(`${c.displayName} was removed from your favourites. Any subscription you have is unchanged.`);
  };

  return (
    <div>
      <div aria-live="polite">{note ? <p className={cn("mb-3 rounded-2xl px-3.5 py-2.5 text-[13px]", EX_CARD)}>{note}</p> : null}</div>
      {page?.items.length ? (
        <ExGroup label="Favourite creators">
          {page.items.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3.5 py-3">
              <Link href={`/u/${c.handle}`} prefetch={false} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <PersonAvatar user={c} size={44} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-[14.5px] font-semibold">
                    <span className="truncate">{c.displayName}</span>
                    {c.verified ? <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-label="Verified" /> : null}
                  </span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">@{c.handle}</span>
                </span>
              </Link>
              {c.offersSubscriptions ? (
                <Link href={`/u/${c.handle}?tab=sub`} prefetch={false} aria-label={`${c.displayName}'s Exclusive posts`} className="inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-[12.5px] font-semibold text-primary transition hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                  {/* the word only where it fits: on a narrow phone the name keeps the room */}
                  <span className="hidden min-[400px]:inline">Exclusive</span>
                </Link>
              ) : null}
              <button type="button" onClick={() => void remove(c)} aria-label={`Remove ${c.displayName} from favourites`} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gold transition hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.08]">
                <Star className="h-[18px] w-[18px] fill-gold" aria-hidden />
              </button>
            </li>
          ))}
        </ExGroup>
      ) : !error ? (
        <div className={cn("rounded-[22px] px-4 py-6 text-center", EX_CARD)}>
          <span aria-hidden className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/15">
            <Star className="h-6 w-6 text-gold" />
          </span>
          <p className="mt-3 text-[15px] font-semibold">No favourite creators yet</p>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">Tap &ldquo;Add to favourites&rdquo; on a creator&apos;s Exclusive tab to keep them one tap away.</p>
          <Link href="/exclusive" prefetch={false} className={cn(exPrimary, "mt-4")}>
            Back to Exclusive <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      ) : null}
      {error ? (
        <div className={cn("mt-2 flex items-center justify-between gap-3 rounded-[22px] px-3.5 py-3", EX_CARD)}>
          <p className="text-[13px] text-muted-foreground">Couldn&apos;t load your favourites.</p>
          <button type="button" onClick={() => void load(page?.next ?? null)} disabled={loading} className={exQuiet}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Retry
          </button>
        </div>
      ) : page?.next ? (
        <button type="button" onClick={() => void load(page.next)} disabled={loading} className={cn(exQuiet, "mt-2 w-full justify-center")}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} {loading ? "Loading…" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
