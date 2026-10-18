"use client";

import { motion } from "framer-motion";
import { ArrowRight, Download, PartyPopper, Users, UsersRound, Lightbulb } from "lucide-react";
import Link from "next/link";
import { memo, type ComponentType } from "react";

import type { SparkCard as SparkCardData } from "@/lib/social/smart-feed";


// Colorless line icons in place of emoji (see [[no-emoji-design]]).
const ICON: Record<SparkCardData["kind"], ComponentType<{ className?: string }>> = {
  creator: Lightbulb,
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
        // a plain white card with the hairline (owner, 2026-10-18: no gradient on content cards, no glow)
        className="frenz-ui group relative block overflow-hidden rounded-[22px] border border-frenz-line bg-frenz-card p-4 shadow-frenz-card transition active:scale-[0.99]"
      >
        {/* ambient glow */}
        <div className="relative flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-frenz-violet/10 text-frenz-violet">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wide text-frenz-muted">Discover</p>
            <p className="truncate text-sm font-bold tracking-tight">{card.title}</p>
            <p className="truncate text-xs text-frenz-muted">{card.body}</p>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-frenz-fill px-3 py-1.5 text-xs font-bold text-frenz-ink transition group-hover:gap-1.5">
            {card.cta}
            <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </span>
        </div>
      </Link>
    </motion.div>
  );
});
