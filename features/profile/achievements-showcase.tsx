import { Award, BadgeCheck, Bookmark, CalendarDays, Flame, Layers, Lock, Rocket, ShieldCheck, Sparkles, TrendingUp, Trophy, Users, type LucideIcon } from "lucide-react";

import { earnedCount, RARITY_META, type EarnedAchievement } from "@/lib/social/achievements";

const ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  layers: Layers,
  users: Users,
  bookmark: Bookmark,
  trending: TrendingUp,
  rocket: Rocket,
  flame: Flame,
  trophy: Trophy,
  badge: BadgeCheck,
  shield: ShieldCheck,
  calendar: CalendarDays,
  award: Award,
};

/**
 * Achievements showcase (owner rail). Premium "digital trophy" tiles instead of
 * flat badges: an earned trophy carries its rarity's metallic gradient + a gloss;
 * a locked one is a calm neutral tile with a lock and a thin real progress bar.
 * Every earned/locked state is DERIVED from real signals (lib/social/achievements.ts) —
 * nothing is falsely awarded. Server-rendered, no client JS.
 */
export function AchievementsShowcase({ achievements }: { achievements: EarnedAchievement[] }) {
  const total = achievements.length;
  const earned = earnedCount(achievements);

  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold">Achievements</h2>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
          {earned} of {total}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-x-2 gap-y-4">
        {achievements.map(({ def, earned: got, progress }) => {
          const Icon = ICONS[def.iconKey] ?? Trophy;
          const meta = RARITY_META[def.rarity];
          return (
            <div key={def.id} className="flex flex-col items-center gap-1.5 text-center" title={def.description}>
              <span className="relative flex h-12 w-12 items-center justify-center">
                <span
                  className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/25"
                  style={
                    got
                      ? { backgroundImage: `linear-gradient(135deg, ${meta.from}, ${meta.to})`, boxShadow: `0 6px 16px -8px ${meta.to}` }
                      : undefined
                  }
                />
                {!got ? <span className="absolute inset-0 rounded-2xl bg-secondary" /> : null}
                {/* diagonal gloss for the premium trophy sheen */}
                {got ? <span aria-hidden className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/30 to-transparent" /> : null}
                <Icon className={`relative h-[22px] w-[22px] ${got ? "text-white" : "text-muted-foreground"}`} />
                {!got ? (
                  <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-card ring-1 ring-border">
                    <Lock className="h-2.5 w-2.5 text-muted-foreground" />
                  </span>
                ) : null}
              </span>

              <span className="line-clamp-2 text-[10px] font-semibold leading-tight">{def.title}</span>

              {got ? (
                <span className="text-[9px] font-semibold" style={{ color: meta.to }}>
                  {meta.label}
                </span>
              ) : (
                <span className="h-1 w-10 overflow-hidden rounded-full bg-secondary">
                  <span className="block h-full rounded-full bg-muted-foreground/50" style={{ width: `${Math.round(progress * 100)}%` }} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
