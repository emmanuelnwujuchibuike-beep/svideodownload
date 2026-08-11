"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Award, Eye, Heart, MessageCircle, UserPlus, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { springs } from "@/lib/motion/springs";
import { cn } from "@/lib/utils";

import { RepostGlyph } from "./repost-glyph";

/**
 * Repost analytics — the reposter's and the creator's (Feature 15 · Part 4).
 *
 * ── 🔴 Every figure is a count of rows in the attribution ledger ─────────
 * Nothing is estimated or extrapolated. A repost that nobody has seen shows
 * "No reach yet", which is the true and by far the most common state. The
 * alternative — a plausible number derived from the post's total views — is
 * the invented proof this project has declined three times, and it would make
 * every honest number here less believable.
 *
 * ── Reach is a NUMBER ────────────────────────────────────────────────────
 * There is no "who saw this" list and no API that could return one. The one
 * place an identity appears is the creator's Top reposters, and only for
 * PUBLIC reposts — which are already on those people's profiles.
 */

interface Counts {
  impression: number;
  open: number;
  like: number;
  comment: number;
  save: number;
  repost: number;
  follow_creator: number;
}

interface MineView {
  repostId: string;
  createdAt: string;
  audience: string;
  caption: string | null;
  counts: Counts;
  friendsReached: number;
  hasData: boolean;
}

interface CreatorView {
  publicReposts: number;
  quoteReposts: number;
  counts: Counts;
  topReposters: {
    userId: string;
    handle: string;
    displayName: string | null;
    avatarUrl: string | null;
    reach: number;
    hasCaption: boolean;
  }[];
  openRate: number | null;
  conversationRate: number | null;
  hasData: boolean;
}

interface ReputationView {
  score: number;
  band: string;
  confident: boolean;
  reasons: string[];
}

export function RepostInsightsSheet({
  postId,
  open,
  onClose,
}: {
  postId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<
    { mine: MineView | null; creator: CreatorView | null; reputation: ReputationView } | null | "error"
  >(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    setData(null);
    let alive = true;
    fetch(`/api/posts/${postId}/repost/insights`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((d) => alive && setData(d))
      .catch(() => alive && setData("error"));
    return () => {
      alive = false;
    };
  }, [open, postId]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[110] flex items-end justify-center sm:items-center">
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
          />
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { y: 24, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { y: 24, opacity: 0 }}
            transition={springs.sheet}
            role="dialog"
            aria-modal="true"
            aria-label="Repost insights"
            className="relative m-2 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-border/60 bg-card/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-2xl"
          >
            <div className="mx-auto mb-2 mt-2.5 h-1 w-9 rounded-full bg-border" />
            <div className="flex items-center justify-between px-5 pb-3">
              <h3 className="flex items-center gap-2 text-sm font-bold">
                <RepostGlyph className="h-4 w-4 text-violet-500" strokeWidth={2.3} /> Repost insights
              </h3>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
              {data === null ? (
                <div className="space-y-2">
                  <div className="h-20 animate-pulse rounded-2xl bg-secondary/50" />
                  <div className="h-20 animate-pulse rounded-2xl bg-secondary/50" />
                </div>
              ) : data === "error" ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Couldn&rsquo;t load insights.</p>
              ) : (
                <Body {...data} />
              )}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function Body({
  mine,
  creator,
  reputation,
}: {
  mine: MineView | null;
  creator: CreatorView | null;
  reputation: ReputationView;
}) {
  const showCreator = creator && creator.publicReposts > 0;
  if (!mine && !showCreator) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        You haven&rsquo;t reposted this, and nobody has reposted it from you.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {mine ? (
        <section>
          <SectionTitle>Your recommendation</SectionTitle>
          {mine.hasData ? (
            <div className="grid grid-cols-2 gap-2">
              <Stat icon={Eye} label="Reached" value={mine.counts.impression} />
              <Stat icon={RepostGlyph} label="Opened it" value={mine.counts.open} />
              <Stat icon={Heart} label="Liked" value={mine.counts.like} />
              <Stat icon={MessageCircle} label="Commented" value={mine.counts.comment} />
              <Stat icon={RepostGlyph} label="Reposted on" value={mine.counts.repost} />
              <Stat icon={UserPlus} label="Followed the creator" value={mine.counts.follow_creator} />
            </div>
          ) : (
            <Empty>No reach yet. Most reposts take a while — or never travel, and that&rsquo;s normal.</Empty>
          )}
          {mine.friendsReached > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {mine.friendsReached === 1 ? "1 of your friends" : `${mine.friendsReached} of your friends`} saw it.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Discovery Bridge™ — stated only when it actually happened. */}
      {mine && mine.counts.follow_creator > 0 ? (
        <section className="rounded-2xl bg-[linear-gradient(120deg,rgba(37,99,235,0.1),rgba(124,58,237,0.1))] p-3.5 ring-1 ring-inset ring-violet-500/20">
          <p className="flex items-center gap-2 text-sm font-bold">
            <Award className="h-4 w-4 text-violet-500" strokeWidth={2.2} /> Discovery Bridge
          </p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            {mine.counts.follow_creator === 1
              ? "Someone followed this creator because you recommended them."
              : `${mine.counts.follow_creator} people followed this creator because you recommended them.`}{" "}
            We never tell anyone who.
          </p>
        </section>
      ) : null}

      <section>
        <SectionTitle>Recommendation Circle</SectionTitle>
        <div className="rounded-2xl bg-secondary/40 p-3.5">
          <p className="text-sm font-bold capitalize">{reputation.band.replace("_", " ")}</p>
          <ul className="mt-1.5 space-y-1">
            {reputation.reasons.map((r, i) => (
              <li key={i} className="text-xs leading-snug text-muted-foreground">
                {r}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground/80">
            Private to you. It is never shown to anyone else and is never stored.
          </p>
        </div>
      </section>

      {showCreator ? (
        <section>
          <SectionTitle>Your post, reposted</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <Stat icon={RepostGlyph} label="Public reposts" value={creator!.publicReposts} />
            <Stat icon={MessageCircle} label="With a note" value={creator!.quoteReposts} />
            <Stat icon={Eye} label="Reached" value={creator!.counts.impression} />
            <Stat icon={UserPlus} label="New followers" value={creator!.counts.follow_creator} />
          </div>
          {creator!.conversationRate != null ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {Math.round(creator!.conversationRate * 100)}% of people who opened it left a comment.
            </p>
          ) : null}

          {creator!.topReposters.length > 0 ? (
            <>
              <p className="mb-1.5 mt-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Top reposters
              </p>
              <ul className="space-y-1">
                {creator!.topReposters.slice(0, 5).map((p) => (
                  <li key={p.userId} className="flex items-center gap-2.5 rounded-xl bg-secondary/40 px-2.5 py-2">
                    {p.avatarUrl ? (
                      <Image src={p.avatarUrl} alt="" width={28} height={28} className="h-7 w-7 rounded-full object-cover" />
                    ) : (
                      <span className="h-7 w-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-600" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {p.displayName || `@${p.handle}`}
                    </span>
                    {p.reach > 0 ? (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{p.reach} reached</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      <p className="pb-1 text-center text-[11px] leading-snug text-muted-foreground/80">
        Counts are people, not sessions — seeing something twice is still one person. Countries and cities
        aren&rsquo;t shown because we don&rsquo;t collect them.
      </p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl bg-secondary/40 px-3.5 py-3 text-xs leading-snug text-muted-foreground">{children}</p>;
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: number;
}) {
  return (
    <div className={cn("rounded-2xl bg-secondary/40 px-3 py-2.5", value === 0 && "opacity-60")}>
      <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={2} />
      <p className="mt-1 text-lg font-bold leading-none tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}
