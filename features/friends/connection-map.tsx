"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

import { bandLabel, type StrengthBand } from "@/lib/social/graph/strength";
import { circleColorClasses } from "@/lib/social/graph/circles";
import type { GraphConnection } from "@/lib/social/graph/overview";
import type { CircleRow } from "@/lib/social/graph/store";
import { cn } from "@/lib/utils";

/**
 * Connection Map™ — the graph, drawn (Feature 18 · Part 17).
 *
 * ── Why concentric rings and not a force simulation ───────────────────────
 * A force-directed graph needs a physics loop, and a physics loop on a phone
 * means a long-running rAF that heats the device and drains the battery for a
 * picture that has already settled. It is also non-deterministic: the same
 * relationships land somewhere different every visit, so nothing is where the
 * member left it, and it cannot be described to a screen reader.
 *
 * Rings solve all three. Position is a pure function of (band, index), so the
 * layout is identical every time, costs one render, and has an exact textual
 * equivalent — closeness is the RADIUS, which is the one thing the map is
 * actually saying. No library, no dependency, no runtime cost after paint.
 *
 * ── Accessibility ────────────────────────────────────────────────────────
 * The SVG is `aria-hidden` and the real content is the list underneath it,
 * which carries the same information as text and is fully keyboard navigable.
 * The picture is decoration over a list, never a replacement for one.
 *
 * ── Motion ───────────────────────────────────────────────────────────────
 * The only animation is a slow orbit drift, and it is behind
 * `motion-reduce:animate-none`. Nothing moves on a timer that the member did
 * not ask for.
 */

const BANDS: { band: StrengthBand; radius: number }[] = [
  { band: "close", radius: 62 },
  { band: "active", radius: 104 },
  { band: "steady", radius: 146 },
  { band: "quiet", radius: 186 },
  { band: "unknown", radius: 186 },
];

const SIZE = 420;
const CENTER = SIZE / 2;

interface Node {
  connection: GraphConnection;
  x: number;
  y: number;
  r: number;
}

function layout(connections: GraphConnection[]): Node[] {
  const nodes: Node[] = [];
  for (const { band, radius } of BANDS) {
    const inRing = connections.filter((c) => c.band === band);
    if (inRing.length === 0) continue;
    // Rings that share a radius (quiet + unknown) must not overlap, so the
    // second one is nudged out.
    const used = nodes.some((n) => Math.abs(Math.hypot(n.x - CENTER, n.y - CENTER) - radius) < 1);
    const r = used ? radius + 22 : radius;
    inRing.forEach((connection, i) => {
      // Offset each ring so nodes don't line up into spokes.
      const angle = (i / inRing.length) * Math.PI * 2 + r * 0.02;
      nodes.push({
        connection,
        x: CENTER + Math.cos(angle) * r,
        y: CENTER + Math.sin(angle) * r,
        r: connection.favorite ? 17 : 14,
      });
    });
  }
  return nodes;
}

export function ConnectionMap({
  connections,
  circles,
  viewerAvatarUrl,
}: {
  connections: GraphConnection[];
  circles: CircleRow[];
  viewerAvatarUrl?: string | null;
}) {
  const [circleFilter, setCircleFilter] = useState<string | null>(null);
  const [focused, setFocused] = useState<GraphConnection | null>(null);

  const shown = useMemo(
    () => (circleFilter ? connections.filter((c) => c.circleIds.includes(circleFilter)) : connections),
    [connections, circleFilter],
  );
  // A busy map is an unreadable map; the list below is always complete.
  const capped = useMemo(() => shown.slice(0, 60), [shown]);
  const nodes = useMemo(() => layout(capped), [capped]);

  if (connections.length === 0) return null;

  return (
    <section>
      {circles.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCircleFilter(null)}
            aria-pressed={circleFilter === null}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
              circleFilter === null ? "bg-brand-tile text-white shadow-sm" : "bg-secondary/60 text-muted-foreground hover:text-foreground",
            )}
          >
            Everyone
          </button>
          {circles.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCircleFilter((cur) => (cur === c.id ? null : c.id))}
              aria-pressed={circleFilter === c.id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                circleFilter === c.id
                  ? "bg-brand-tile text-white shadow-sm"
                  : "bg-secondary/60 text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  circleFilter === c.id ? "bg-white/90" : circleColorClasses(c.color).dot,
                )}
              />
              {c.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
        <div className="relative mx-auto aspect-square w-full max-w-[420px]">
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full" aria-hidden="true" focusable="false">
            {/* Rings — the scale the map is drawn on */}
            {[62, 104, 146, 186, 208].map((r) => (
              <circle
                key={r}
                cx={CENTER}
                cy={CENTER}
                r={r}
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                className="text-border/50"
              />
            ))}

            {/* Reuses Tailwind's `spin` keyframes rather than adding a global
                one — 150s is slow enough to read as drift, not rotation. */}
            <g
              className="motion-safe:animate-[spin_150s_linear_infinite] motion-reduce:animate-none"
              style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
            >
              {nodes.map((n) => (
                <line
                  key={`l-${n.connection.user.id}`}
                  x1={CENTER}
                  y1={CENTER}
                  x2={n.x}
                  y2={n.y}
                  stroke="currentColor"
                  strokeWidth={n.connection.band === "close" ? 1.4 : 0.7}
                  className={n.connection.band === "close" ? "text-primary/40" : "text-border/70"}
                />
              ))}
              {nodes.map((n) => (
                <circle
                  key={`n-${n.connection.user.id}`}
                  cx={n.x}
                  cy={n.y}
                  r={n.r}
                  className={cn(
                    "transition",
                    focused?.user.id === n.connection.user.id ? "fill-primary" : "fill-secondary",
                  )}
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeOpacity={0.5}
                />
              ))}
            </g>

            <circle cx={CENTER} cy={CENTER} r={26} className="fill-primary" />
          </svg>

          {viewerAvatarUrl ? (
            <span className="pointer-events-none absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full ring-2 ring-white/70">
              <Image src={viewerAvatarUrl} alt="" fill sizes="44px" className="object-cover" />
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground">
          {(["close", "active", "steady", "quiet"] as StrengthBand[]).map((b) => (
            <span key={b} className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />
              {bandLabel(b)}
            </span>
          ))}
          <span className="opacity-70">Closer to the centre = more contact</span>
        </div>
      </div>

      {/* The accessible, complete equivalent of the picture. */}
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {shown.map((c) => (
          <li key={c.user.id}>
            <Link
              href={`/u/${c.user.handle}`}
              prefetch={false}
              onMouseEnter={() => setFocused(c)}
              onMouseLeave={() => setFocused(null)}
              onFocus={() => setFocused(c)}
              onBlur={() => setFocused(null)}
              className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card px-3 py-2 transition hover:bg-secondary/40"
            >
              <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-secondary">
                {c.user.avatarUrl ? (
                  <Image src={c.user.avatarUrl} alt="" fill sizes="36px" className="object-cover" />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{c.user.displayName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {bandLabel(c.band)}
                  {c.label ? ` · ${c.label}` : ""}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {shown.length > capped.length ? (
        <p className="mt-2 px-1 text-[11px] text-muted-foreground">
          The map shows your {capped.length} nearest connections; the list above is complete.
        </p>
      ) : null}
    </section>
  );
}
