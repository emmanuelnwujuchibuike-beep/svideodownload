import { CalendarClock, Flag, FileText, Layers, Lock, Shield, Sparkles, Trophy, Users, type LucideIcon } from "lucide-react";

import { SETTINGS_TINTS } from "@/features/account/settings-ui";
import type { JourneyEntry } from "@/lib/social/life-journey";
import { cn } from "@/lib/utils";

const ICONS: Record<JourneyEntry["iconKey"], LucideIcon> = {
  flag: Flag,
  file: FileText,
  layers: Layers,
  users: Users,
  shield: Shield,
  trophy: Trophy,
};

/**
 * Life Journey™ (owner rail) — a chronological timeline of real milestones (join
 * date, first post) plus current-state highlights (posts, friends, rank,
 * achievements). Every entry is DERIVED from real data; nothing is invented.
 *
 * Each moment is its OWN soft card (not bare text pinned to a line) — the same
 * "moment card" language the reference timeline design uses — with generous
 * spacing and a gradient rail, so it reads as premium at the ~300px rail width
 * on desktop and at full mobile width alike. Server-rendered, no client JS.
 */
export function LifeJourneyCard({ entries }: { entries: JourneyEntry[] }) {
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-tile text-white shadow-sm">
          <Sparkles className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold leading-tight">Life Journey</h2>
          <p className="text-xs text-muted-foreground">Your story on Frenzsave, so far</p>
        </div>
      </div>

      <ol className="relative flex flex-col gap-3">
        {/* The rail — a soft gradient line, not a flat border, so it reads as a
            premium thread rather than a plain divider. Positioned to run through
            the center of each 40px node (left: 19px = half the node width). */}
        <span aria-hidden className="pointer-events-none absolute bottom-2 left-[19px] top-2 w-px bg-gradient-to-b from-border via-border/70 to-transparent" />

        {entries.map((e, i) => {
          const Icon = ICONS[e.iconKey];
          const isLast = i === entries.length - 1;
          return (
            <li key={e.key} className="relative flex items-start gap-3.5 sm:gap-4">
              <span
                className={cn(
                  "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-[5px] ring-card",
                  SETTINGS_TINTS[e.tint] ?? SETTINGS_TINTS.slate,
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <div
                className={cn(
                  "min-w-0 flex-1 rounded-2xl border border-border/50 bg-secondary/25 px-3.5 py-3",
                  isLast && "mb-0",
                )}
              >
                <p className="text-sm font-semibold leading-snug">{e.title}</p>
                {e.sub ? <p className="mt-1 text-xs leading-snug text-muted-foreground">{e.sub}</p> : null}
                {e.date ? (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    <CalendarClock className="h-3 w-3 shrink-0" />
                    {new Date(e.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
        <Lock className="h-4 w-4 shrink-0" />
        <span>
          Time Capsule, Year in Review &amp; your Private Journal — <span className="font-semibold text-foreground/80">coming soon</span>
        </span>
      </div>
    </section>
  );
}
