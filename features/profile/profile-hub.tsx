"use client";

import {
  Activity,
  Award,
  BadgeCheck,
  BarChart3,
  BookOpen,
  Briefcase,
  ChevronRight,
  Clock,
  FileText,
  Flag,
  Flame,
  GraduationCap,
  HeartPulse,
  Hourglass,
  IdCard,
  LayoutGrid,
  NotebookPen,
  Package,
  ShieldCheck,
  Sparkles,
  SunMoon,
  Trophy,
  Users,
  Wand2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { HUB_META, type HubEntry, type HubKey } from "@/lib/profile/hub";
import { prefetchHubSection } from "@/lib/profile/hub-client";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/*
  The modal — the sheet shell, the strip loader and every section's panel —
  is one lazy chunk, fetched the first time a button is pressed. The hub
  itself is the buttons and an IntersectionObserver: that is the whole cost
  the profile pays on landing.
*/
const ProfileHubModal = dynamic(() => import("@/features/profile/profile-hub-modal").then((m) => m.ProfileHubModal), { ssr: false });

const ICONS: Record<string, LucideIcon> = {
  IdCard,
  Trophy,
  LayoutGrid,
  Briefcase,
  GraduationCap,
  BadgeCheck,
  Award,
  BookOpen,
  Sparkles,
  FileText,
  Package,
  Wrench,
  Clock,
  Flame,
  ShieldCheck,
  HeartPulse,
  BarChart3,
  Flag,
  Hourglass,
  NotebookPen,
  Users,
  Activity,
  Wand2,
  SunMoon,
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PROFILE HUB — every other section, as a button that opens a modal
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13: "put all the cards in a button and they open as a
 * premium modal, all sections card except from the hero, experience mode and
 * media grid… to free up the profile landing budget and speed."
 *
 * What the landing document carries for each section is ONE button: a
 * glossy tile, a label and a short fact. Its data is read when the button
 * scrolls into view — one section at a time, through the queue in
 * lib/profile/hub-client.ts — or when it is tapped, in which case the modal
 * opens at once with a strip loader across its top until the answer lands.
 *
 * The buttons are premium and professional, not decorative: a two-column
 * grid on a phone, three on wider screens, each a 64px tap target with a
 * gradient tile in the section's own colour and a chevron, pressed with
 * the same haptic and scale the rest of the app uses.
 */
export function ProfileHub({ handle, entries, className }: { handle: string; entries: HubEntry[]; className?: string }) {
  const [open, setOpen] = useState<HubKey | null>(null);
  const [mounted, setMounted] = useState(false);

  const openKey = useCallback((key: HubKey) => {
    haptic("selection");
    setMounted(true);
    setOpen(key);
  }, []);
  const close = useCallback(() => setOpen(null), []);

  if (entries.length === 0) return null;

  return (
    <section aria-label="More on this profile" className={cn("mt-6", className)}>
      <h2 className="mb-3 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">More on this profile</h2>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {entries.map((entry) => (
          <HubButton key={entry.key} handle={handle} entry={entry} onOpen={openKey} />
        ))}
      </div>
      {mounted ? <ProfileHubModal handle={handle} open={open} onClose={close} /> : null}
    </section>
  );
}

function HubButton({ handle, entry, onOpen }: { handle: string; entry: HubEntry; onOpen: (key: HubKey) => void }) {
  const meta = HUB_META[entry.key];
  const Icon = ICONS[meta.icon] ?? Sparkles;
  const ref = useRef<HTMLButtonElement | null>(null);

  /*
    Prefetch when the button is about to be seen — 160px before it enters the
    viewport — and only once. The queue serialises the reads, so a fast
    scroll past every button still costs one request at a time.
  */
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          prefetchHubSection(handle, entry.key);
          io.disconnect();
        }
      },
      { rootMargin: "160px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [handle, entry.key]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onOpen(entry.key)}
      className={cn(
        "group flex min-h-[64px] items-center gap-2.5 rounded-2xl border border-border/70 bg-card px-3 py-2.5 text-left sm:gap-3",
        "shadow-[0_1px_0_rgb(255_255_255/0.6)_inset,0_10px_24px_-18px_rgb(15_23_42/0.35)] transition",
        "hover:-translate-y-0.5 hover:border-foreground/20 active:translate-y-0 active:scale-[0.98]",
        "dark:shadow-[0_1px_0_rgb(255_255_255/0.06)_inset,0_10px_24px_-18px_rgb(0_0_0/0.6)]",
      )}
    >
      <span
        aria-hidden
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm sm:h-10 sm:w-10"
        style={{ background: `linear-gradient(135deg, ${meta.tint[0]}, ${meta.tint[1]})` }}
      >
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-b from-white/30 to-transparent" />
        <Icon className="relative h-[18px] w-[18px]" strokeWidth={2.25} />
      </span>
      <span className="min-w-0 flex-1">
        {/* 13px on a phone so "Certifications" and "Hours & location" fit beside the tile; the chevron is desktop-only for the same reason */}
        <span className="block truncate text-[13px] font-bold leading-tight sm:text-[13.5px]">{meta.label}</span>
        <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-muted-foreground">{entry.sub ?? meta.blurb}</span>
      </span>
      <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground/60 transition group-hover:translate-x-0.5 group-hover:text-foreground sm:block" aria-hidden />
    </button>
  );
}
