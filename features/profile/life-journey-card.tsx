import { Flag, FileText, Layers, Shield, Trophy, Users, type LucideIcon } from "lucide-react";

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
 * Server-rendered, no client JS. Time Capsule, Year in Review, Private Journal
 * and Digital Legacy are declared next layers, not built here.
 */
export function LifeJourneyCard({ entries }: { entries: JourneyEntry[] }) {
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
      <h2 className="mb-4 text-base font-bold">Life Journey</h2>
      <ol className="relative space-y-4 border-l border-border/60 pl-5">
        {entries.map((e) => {
          const Icon = ICONS[e.iconKey];
          return (
            <li key={e.key} className="relative">
              <span
                className={cn(
                  "absolute -left-[1.72rem] flex h-8 w-8 items-center justify-center rounded-full ring-4 ring-card",
                  SETTINGS_TINTS[e.tint] ?? SETTINGS_TINTS.slate,
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <p className="text-sm font-semibold leading-tight">{e.title}</p>
              {e.sub ? <p className="mt-0.5 text-xs text-muted-foreground">{e.sub}</p> : null}
              {e.date ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(e.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Time Capsule, Year in Review &amp; your Private Journal — <span className="font-semibold text-foreground/80">coming soon</span>.
      </p>
    </section>
  );
}
