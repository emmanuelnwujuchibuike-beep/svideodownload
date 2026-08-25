"use client";

import { Music2, Radar, Sparkles, UserPlus, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";

import { ORBITS, type OrbitCard, type OrbitId, type OrbitResult } from "@/lib/social/orbits-catalogue";
import { cn } from "@/lib/utils";

const ORBIT_ICON: Partial<Record<OrbitId, typeof Users>> = {
  friend: Users,
  creator: UserPlus,
  music: Music2,
  nearby: Radar,
  community: Sparkles,
};

/**
 * Discovery Orbit™ (Feature 15 Part 8) — a horizontal rail of distinct
 * discovery feeds, sitting above Explore's existing Trending/Recent +
 * category controls (untouched). Each orbit is a thin adapter over data this
 * app already computes (see lib/social/orbits.ts) — this component's only
 * job is tabs + a card rail, cached per orbit so re-selecting one already
 * viewed is instant.
 */
export function OrbitRail({ initialOrbit, initialResult }: { initialOrbit: OrbitId; initialResult: OrbitResult }) {
  const cache = useRef<Map<OrbitId, OrbitResult>>(new Map([[initialOrbit, initialResult]]));
  const reqId = useRef(0);
  const [orbit, setOrbit] = useState<OrbitId>(initialOrbit);
  const [result, setResult] = useState<OrbitResult>(initialResult);
  const [loading, setLoading] = useState(false);

  const select = async (next: OrbitId) => {
    setOrbit(next);
    const cached = cache.current.get(next);
    if (cached) {
      setResult(cached);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/orbit?orbit=${next}&limit=12`);
      const json = (await res.json()) as OrbitResult;
      if (id !== reqId.current) return;
      cache.current.set(next, json);
      setResult(json);
    } catch {
      /* keep current rail */
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  };

  return (
    <div className="mb-4">
      <div role="tablist" aria-label="Discovery orbits" className="explore-rail -mx-3 gap-1.5 px-3 sm:-mx-4 sm:px-4">
        {ORBITS.map((o) => {
          const Icon = ORBIT_ICON[o.id];
          const active = orbit === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => void select(o.id)}
              className={cn(
                "shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-150",
                active
                  ? "bg-foreground text-background"
                  : "bg-secondary/70 text-muted-foreground ring-1 ring-inset ring-border/50 hover:text-foreground",
              )}
            >
              {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
              {o.label}
            </button>
          );
        })}
      </div>

      <div className="mt-2.5">
        {result.deferred ? (
          <p className="rounded-2xl border border-dashed border-border/70 px-4 py-5 text-center text-xs text-muted-foreground">
            {result.deferredReason}
          </p>
        ) : loading ? (
          <RailSkeleton />
        ) : result.cards.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/70 px-4 py-5 text-center text-xs text-muted-foreground">
            Nothing here yet — check back soon.
          </p>
        ) : (
          <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollSnapType: "x mandatory" }}>
            {result.cards.map((c) => (
              <OrbitCardTile key={c.id} card={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Exported for reuse by `collections-rail.tsx` — same tile, same rules
 *  (square avatar for a creator card, poster-ratio tile for everything else). */
export function OrbitCardTile({ card }: { card: OrbitCard }) {
  const isPerson = card.kind === "creator";
  return (
    <Link
      href={card.href}
      prefetch
      style={{ scrollSnapAlign: "start" }}
      className="group w-[128px] shrink-0"
    >
      <div
        className={cn(
          "relative overflow-hidden bg-secondary",
          isPerson ? "aspect-square rounded-full" : "aspect-[3/4] rounded-2xl",
        )}
      >
        {card.imageUrl ? (
          <Image
            src={card.imageUrl}
            alt=""
            fill
            sizes="128px"
            className="object-cover transition-transform duration-200 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            {card.kind === "sound" ? <Music2 className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
          </div>
        )}
      </div>
      <p className="mt-1.5 truncate text-center text-xs font-semibold">{card.title}</p>
      {card.subtitle ? <p className="truncate text-center text-[11px] text-muted-foreground">{card.subtitle}</p> : null}
    </Link>
  );
}

function RailSkeleton() {
  return (
    <div className="flex gap-2.5 overflow-hidden pb-1" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="w-[128px] shrink-0">
          <div className="aspect-[3/4] animate-pulse rounded-2xl bg-secondary" />
          <div className="mt-1.5 h-3 w-2/3 animate-pulse rounded bg-secondary" />
        </div>
      ))}
    </div>
  );
}
