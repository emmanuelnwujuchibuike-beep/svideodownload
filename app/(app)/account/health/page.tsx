import { ArrowRight, Check, ChevronRight, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SettingsPage } from "@/features/account/settings-page";
import { HealthRing } from "@/features/profile/health-card";
import { BAND_LABEL, PLANNED_INTELLIGENCE, type PillarKey } from "@/lib/profile/health";
import { getProfileHealth } from "@/lib/social/profile-health";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Profile health", robots: { index: false, follow: false } };

const PILLAR_TINT: Record<PillarKey, string> = {
  identity: "from-violet-500 to-fuchsia-500",
  security: "from-emerald-500 to-teal-500",
  privacy: "from-blue-500 to-cyan-500",
  content: "from-amber-500 to-orange-500",
  community: "from-rose-500 to-pink-500",
  standing: "from-indigo-500 to-violet-500",
};

/**
 * Profile Health Dashboard — the Digital Coach™ (Feature 18 · Part 15).
 *
 * Every number here is computed from the member's own data by a formula written
 * out in `lib/profile/health.ts`. Nothing is inferred by a model, nothing is
 * sent anywhere, and every recommendation links to the exact screen that fixes
 * it. The page says so out loud, because a member acting on advice about their
 * own security is owed the reasoning behind it.
 */
export default async function ProfileHealthPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/health");

  const health = await getProfileHealth(user);
  const done = health.recommendations.length === 0;

  return (
    <SettingsPage title="Profile health" description="What's working, what to fix, and why." bare>
      {/* Score */}
      <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
          <HealthRing score={health.score} band={health.band} size={132} />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="text-xl font-bold tracking-[-0.02em]">{BAND_LABEL[health.band]}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {done
                ? "Everything we can check is in good shape. This score updates as your profile and account change."
                : `${health.recommendations.length} thing${health.recommendations.length === 1 ? "" : "s"} we'd suggest looking at. Nothing here is required — it's your profile.`}
            </p>
            {health.strengths.length > 0 ? (
              <ul className="mt-3 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                {health.strengths.map((s) => (
                  <li
                    key={s}
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"
                  >
                    <Check className="h-3 w-3" /> {s}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="mt-5">
        <p className="px-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Breakdown</p>
        <div className="mt-2 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
          <div className="divide-y divide-border/60">
            {health.pillars.map((p) => (
              <div key={p.key} className="px-3.5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{p.label}</p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{p.blurb}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-sm font-bold tabular-nums">{p.score}</span>
                    <span className="text-xs text-muted-foreground">/100</span>
                    {/* The weight is shown so the total is never a mystery. */}
                    <p className="text-[10px] text-muted-foreground">{p.weight}% of score</p>
                  </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn("h-full rounded-full bg-gradient-to-r", PILLAR_TINT[p.key])}
                    style={{ width: `${p.score}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The coach */}
      <section className="mt-5">
        <p className="px-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {done ? "Checkup" : "Suggested"}
        </p>
        {done ? (
          <div className="mt-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-5 text-center">
            <Check className="mx-auto h-6 w-6 text-emerald-500" />
            <p className="mt-2 text-sm font-semibold">Nothing to suggest right now.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Come back after you&apos;ve changed something — this recalculates every time you open it.
            </p>
          </div>
        ) : (
          <div className="mt-2 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
            <div className="divide-y divide-border/60">
              {health.recommendations.map((r) => (
                <Link
                  key={r.id}
                  href={r.href}
                  prefetch={false}
                  className="flex items-start gap-3 px-3.5 py-3 transition hover:bg-secondary/40"
                >
                  <span
                    className={cn(
                      "mt-1 h-2 w-2 shrink-0 rounded-full bg-gradient-to-r",
                      PILLAR_TINT[r.pillar],
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{r.title}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{r.detail}</span>
                  </span>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* How this works — transparency is a feature of the product, not a footnote */}
      <section className="mt-5 rounded-2xl bg-secondary/40 px-3.5 py-3">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">How this is worked out</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          This score is calculated on our servers from your own account settings and profile — by a fixed formula, not
          by an AI model. Nothing about your profile is sent anywhere to produce it, and nothing here is shared with
          anyone else: your health score is visible only to you. Reach — followers, likes, views — is deliberately{" "}
          <span className="font-semibold text-foreground">not</span> part of the score, because a good profile
          shouldn&apos;t depend on being popular.
        </p>
      </section>

      {/* Declared, not built */}
      <section className="mt-5">
        <p className="px-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Not built yet</p>
        <div className="mt-2 space-y-2">
          {PLANNED_INTELLIGENCE.map((p) => (
            <div
              key={p.title}
              className="flex items-start gap-3 rounded-2xl border border-dashed border-border/70 px-3.5 py-3 opacity-75"
            >
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{p.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">Waiting on {p.needs}.</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <Link
        href="/account"
        prefetch
        className="mt-5 flex items-center justify-between rounded-2xl bg-secondary/50 px-3.5 py-3 text-sm font-semibold transition hover:bg-secondary"
      >
        Back to settings
        <ArrowRight className="h-4 w-4" />
      </Link>
    </SettingsPage>
  );
}
