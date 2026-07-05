"use client";

import { motion } from "framer-motion";
import { ArrowRight, Download, PartyPopper, Sparkles, Users, UsersRound } from "lucide-react";
import Link from "next/link";
import { memo, type ComponentType } from "react";

import type { SparkCard as SparkCardData } from "@/lib/social/smart-feed";

const TINT: Record<SparkCardData["kind"], string> = {
  creator: "from-blue-600/20 to-violet-600/20 ring-violet-500/25",
  download: "from-emerald-500/20 to-teal-500/20 ring-emerald-500/25",
  friends: "from-sky-500/20 to-blue-600/20 ring-sky-500/25",
  community: "from-fuchsia-500/20 to-purple-600/20 ring-fuchsia-500/25",
  milestone: "from-amber-500/25 to-orange-500/20 ring-amber-500/30",
};

// Colorless line icons in place of emoji (see [[no-emoji-design]]).
const ICON: Record<SparkCardData["kind"], ComponentType<{ className?: string }>> = {
  creator: Sparkles,
  download: Download,
  friends: UsersRound,
  community: Users,
  milestone: PartyPopper,
};

/**
 * An elegant, interactive discovery card woven between posts (Feature 5,
 * exclusive #3). It reads as a delightful discovery — never an advertisement —
 * with a soft electric glow and a clear, honest destination.
 */
export const SparkCard = memo(function SparkCard({ card }: { card: SparkCardData }) {
  const Icon = ICON[card.kind];
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Link
        href={card.href}
        className={`group relative block overflow-hidden rounded-3xl bg-gradient-to-br ${TINT[card.kind]} p-5 ring-1 ring-inset backdrop-blur-xl transition hover:-translate-y-0.5`}
      >
        {/* ambient glow */}
        <div aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/20 blur-3xl dark:bg-white/10" />
        <div className="relative flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-background/60 text-foreground shadow-soft ring-1 ring-border/50">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wide text-foreground/60">Discover</p>
            <p className="truncate text-sm font-bold tracking-tight">{card.title}</p>
            <p className="truncate text-xs text-muted-foreground">{card.body}</p>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-background/70 px-3 py-1.5 text-xs font-semibold shadow-soft ring-1 ring-border/50 transition group-hover:gap-1.5">
            {card.cta}
            <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </span>
        </div>
      </Link>
    </motion.div>
  );
});
