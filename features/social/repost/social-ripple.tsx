"use client";

import { motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { RepostGlyph } from "./repost-glyph";

/**
 * Social Ripple™ — how a reel actually spread (Feature 15 · Part 4).
 *
 * "Instead of showing simple repost counts, visualize how a reel spreads."
 *
 * ── 🔴 Every node here is a row that exists ──────────────────────────────
 * The tree comes from `ripple.ts`, which walks real `source_repost_id` edges.
 * The version of this that would look best — a generated fan-out sized from a
 * repost COUNT — is a picture of nothing, and it is the fabricated social proof
 * this project has declined three times. A reel two people reposted
 * independently draws two nodes side by side, because that is what happened.
 *
 * ── The untraceable layer says so ────────────────────────────────────────
 * Layer 1 is by construction the layer with nothing reachable above it: a null
 * edge (found it in Explore, or a repost made before migration 0116) and a
 * dangling one both land there. The note is rendered, not hidden — drawing
 * those as "straight from the creator" would invent a hop and would make every
 * historical reel look like it spread perfectly.
 *
 * ── Motion ───────────────────────────────────────────────────────────────
 * Layers fade and rise in sequence, one short beat apart, so the eye follows
 * the spread outward rather than being handed a finished diagram. `transform`
 * and `opacity` only. Under `prefers-reduced-motion` the stagger is dropped and
 * the tree simply appears — the INFORMATION was never in the animation.
 */

export interface RippleNodeView {
  repostId: string;
  reposterId: string;
  name: string;
  avatarUrl: string | null;
  depth: number;
  childCount: number;
  provenanceUnknown: boolean;
  isConnection: boolean;
}

export interface RippleView {
  creator: { id: string; name: string; avatarUrl: string | null };
  layers: { depth: number; label: string; note?: string; nodes: RippleNodeView[] }[];
  totalReposts: number;
  maxDepth: number;
  unknownProvenance: number;
  untracedParents: number;
  longestChain: string[];
}

export function SocialRipple({ ripple, className }: { ripple: RippleView; className?: string }) {
  const reduceMotion = useReducedMotion();

  if (ripple.totalReposts === 0) {
    return (
      <div className={cn("rounded-2xl bg-secondary/40 px-4 py-6 text-center", className)}>
        <p className="text-sm font-semibold">Nobody has reposted this yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          When someone recommends it, you&rsquo;ll see how far it travels.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      {/* The creator — the root, always drawn, never a repost. */}
      <RippleRow
        index={0}
        reduceMotion={!!reduceMotion}
        label="Original creator"
        nodes={[
          {
            repostId: "creator",
            reposterId: ripple.creator.id,
            name: ripple.creator.name,
            avatarUrl: ripple.creator.avatarUrl,
            depth: 0,
            childCount: ripple.layers[0]?.nodes.length ?? 0,
            provenanceUnknown: false,
            isConnection: false,
          },
        ]}
        isCreator
      />

      {ripple.layers.map((layer, i) => (
        <RippleRow
          key={layer.depth}
          index={i + 1}
          reduceMotion={!!reduceMotion}
          label={layer.label}
          note={layer.note}
          nodes={layer.nodes}
        />
      ))}

      <p className="pt-3 text-center text-xs text-muted-foreground">
        {ripple.totalReposts === 1
          ? "1 repost"
          : `${ripple.totalReposts} reposts`}
        {ripple.maxDepth > 1 ? ` · reached ${ripple.maxDepth} steps from the creator` : null}
      </p>
    </div>
  );
}

function RippleRow({
  label,
  note,
  nodes,
  index,
  reduceMotion,
  isCreator = false,
}: {
  label: string;
  note?: string;
  nodes: RippleNodeView[];
  index: number;
  reduceMotion: boolean;
  isCreator?: boolean;
}) {
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { delay: index * 0.09, duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* The connector. Purely decorative, so it is hidden from assistive tech —
          the layer LABEL already carries the relationship in words. */}
      {index > 0 ? (
        <div aria-hidden className="flex justify-center py-1">
          <span className="h-5 w-px bg-gradient-to-b from-blue-500/50 to-violet-500/50" />
        </div>
      ) : null}

      <div className="rounded-2xl bg-secondary/40 px-3 py-2.5">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="flex flex-wrap gap-1.5">
          {nodes.map((n) => (
            <span
              key={n.repostId}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-xs font-semibold",
                isCreator
                  ? "bg-[linear-gradient(100deg,#2563eb,#7c3aed)] text-white"
                  : n.isConnection
                    ? "bg-blue-500/10 text-foreground ring-1 ring-inset ring-blue-500/25"
                    : "bg-background text-muted-foreground ring-1 ring-inset ring-border/70",
              )}
            >
              {n.avatarUrl ? (
                <Image
                  src={n.avatarUrl}
                  alt=""
                  width={20}
                  height={20}
                  className="h-5 w-5 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-[9px] font-bold text-white">
                  {n.name.replace(/^@/, "").charAt(0).toUpperCase()}
                </span>
              )}
              <span className="max-w-[9rem] truncate">{n.name}</span>
              {n.childCount > 0 ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full px-1.5 text-[10px] font-bold",
                    isCreator ? "bg-white/20" : "bg-secondary",
                  )}
                  title={`${n.childCount} onward ${n.childCount === 1 ? "repost" : "reposts"}`}
                >
                  <RepostGlyph className="h-2.5 w-2.5" strokeWidth={2.6} />
                  {n.childCount}
                </span>
              ) : null}
            </span>
          ))}
        </div>
        {note ? <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{note}</p> : null}
      </div>
    </motion.div>
  );
}

/** Fetches and renders the ripple for a post. Used by the repost page. */
export function SocialRippleLoader({ postId }: { postId: string }) {
  const [ripple, setRipple] = useState<RippleView | null | "error">(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/posts/${postId}/ripple`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((d: { ripple: RippleView }) => alive && setRipple(d.ripple))
      .catch(() => alive && setRipple("error"));
    return () => {
      alive = false;
    };
  }, [postId]);

  if (ripple === null) {
    return <div className="h-28 animate-pulse rounded-2xl bg-secondary/50" />;
  }
  if (ripple === "error") {
    // No fabricated fallback. If the spread can't be read, say so.
    return <p className="text-sm text-muted-foreground">Couldn&rsquo;t load how this spread.</p>;
  }
  return <SocialRipple ripple={ripple} />;
}
